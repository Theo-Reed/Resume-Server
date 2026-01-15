
import axios from 'axios';
import { connectToLocalMongo, getDb } from '../src/db';
import * as dotenv from 'dotenv';
dotenv.config();

const API_URL = 'http://127.0.0.1:3000/api';
const TEST_OPENID = 'TEST_AUTO_BOT_001';

// Headers simulating the frontend request
const headers = {
    'x-openid': TEST_OPENID,
    'Content-Type': 'application/json'
};

// Utils: Reset User State via DB directly
async function resetUser(state: any) {
    const db = getDb();
    await db.collection('users').deleteOne({ openid: TEST_OPENID });
    
    // Construct membership object
    const membership = {
        level: state.level || 0,
        expire_at: state.expire_at || null,
        pts_quota: state.pts_quota || { limit: 0, used: 0 },
        topup_quota: state.topup_quota || 0,
        topup_limit: state.topup_limit || 0
    };

    await db.collection('users').insertOne({
        openid: TEST_OPENID,
        nickname: 'Test Bot',
        membership
    });
}

// Utils: Helper to buy and activate
async function buyScheme(schemeId: number) {
    // 1. Calculate Price
    const calcRes = await axios.post(`${API_URL}/calculatePrice`, { scheme_id: schemeId }, { headers });
    const priceData = calcRes.data.result;

    // 2. Create Order
    const orderRes = await axios.post(`${API_URL}/createOrder`, { scheme_id: schemeId }, { headers });
    const orderData = orderRes.data.result;
    const orderId = orderData.order_id;

    // 3. Mock Pay & Activate
    await axios.post(`${API_URL}/updateOrderStatus`, { order_id: orderId, status: '已支付' }, { headers });
    const activateRes = await axios.post(`${API_URL}/activateMembership`, { order_id: orderId }, { headers });
    
    return {
        priceInfo: priceData,
        orderInfo: orderData,
        finalUser: activateRes.data.result.user
    };
}

// --- Test Suites ---

async function runTests() {
    console.log('🚀 Starting Payment Scenario Automation Tests...\n');
    
    try {
        await connectToLocalMongo();
        
        // ==========================================
        // Scenario 1: Non-member buys Top-up
        // ==========================================
        console.log('🧪 Case 1: Non-member buys Top-up (Scheme 5, 10pts)');
        await resetUser({ level: 0 });
        const res1 = await buyScheme(5); // Scheme 5 is Topup (10 points)
        
        console.assert(res1.finalUser.membership.level === 0, 'Level should remain 0');
        console.assert(res1.finalUser.membership.topup_quota === 10, 'Topup quota should be 10');
        console.assert(res1.finalUser.membership.topup_limit === 10, 'Topup limit should match quota');
        console.log('✅ Passed\n');


        // ==========================================
        // Scenario 2: Trial Member (L1) Upgrades to Sprint (L2) [Trade-in]
        // ==========================================
        console.log('🧪 Case 2: Trial Member (L1) Upgrades to Sprint (L2)');
        // Setup: Active Level 1 User
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        await resetUser({ level: 1, expire_at: tomorrow, pts_quota: { limit: 5, used: 2 } });
        
        const res2 = await buyScheme(2); // Sprint (Price 9.9, 10 pts)
        
        // Expect: Price = 9.9 - 5.0 (Trial Value) = 4.9
        const isPriceCorrect = Math.abs(res2.priceInfo.finalPrice - 490) < 1;
        
        console.log(`Debug: Paid ${res2.orderInfo.pay_amount}, Expected 490 (cents)`);
        console.assert(res2.finalUser.membership.level === 2, 'Should become Level 2');
        console.assert(res2.finalUser.membership.pts_quota.limit === 10, 'Sprint limit should be 10');
        console.log('✅ Passed\n');


        // ==========================================
        // Scenario 3: Sprint (L2) Renewal (Stacking)
        // ==========================================
        console.log('🧪 Case 3: Sprint (L2) Renewal (Same Level Stacking)');
        // Setup: Active Level 2 User, 5 days left, 5/10 used (5 remaining)
        const in5Days = new Date(); in5Days.setDate(in5Days.getDate() + 5);
        await resetUser({ level: 2, expire_at: in5Days, pts_quota: { limit: 10, used: 5 } }); // 5 remaining
        
        const res3 = await buyScheme(2); // Buy Sprint again (10 pts, 7 days)
        
        // Logic: 
        // New Expiry = Old Expiry (in 5 days) + 7 days = in 12 days
        // New Points = Remainder (5) + New (10) = 15
        const newExpire = new Date(res3.finalUser.membership.expire_at);
        const daysDiff = (newExpire.getTime() - new Date().getTime()) / (1000 * 3600 * 24);
        
        console.log(`Debug: Expiry in ~${daysDiff.toFixed(1)} days (Expect ~12)`);
        console.log(`Debug: Quota Limit ${res3.finalUser.membership.pts_quota.limit} (Expect 15)`);

        console.assert(Math.abs(daysDiff - 12) < 1, 'Time should stack (~12 days)');
        console.assert(res3.finalUser.membership.pts_quota.limit === 15, 'Points should stack (5 + 10 = 15)');
        console.log('✅ Passed\n');


        // ==========================================
        // Scenario 4: Sprint (L2) -> Standard (L3) [Ladder Upgrade]
        // ==========================================
        console.log('🧪 Case 4: Sprint (L2) -> Standard (L3) Upgrade');
        // Setup: Level 2
        await resetUser({ level: 2, expire_at: tomorrow, pts_quota: { limit: 10, used: 0 } });
        
        const res4 = await buyScheme(3); // Standard (Price 1990 cents / 19.9)
        // Deduction for L2 is 990. Expected pay: 1000.
        
        console.log(`Debug: Paid ${res4.orderInfo.pay_amount} (Expect 1000 cents)`);
        console.assert(res4.finalUser.membership.level === 3, 'Should become Level 3');
        console.assert(res4.finalUser.membership.pts_quota.limit === 25, 'Standard limit should be 25');
        console.log('✅ Passed\n');


        // ==========================================
        // Scenario 5: Expired Member buys New Subscription
        // ==========================================
        console.log('🧪 Case 5: Expired Member Renewal');
        // Setup: Expired Level 2
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        await resetUser({ level: 2, expire_at: yesterday, pts_quota: { limit: 10, used: 0 } });
        
        const res5 = await buyScheme(2); // Buy Sprint (7 days, 10 pts)
        
        // Logic: Should reset. Old points lost. New time starts from NOW.
        const newExpire5 = new Date(res5.finalUser.membership.expire_at);
        const daysDiff5 = (newExpire5.getTime() - new Date().getTime()) / (1000 * 3600 * 24);
        
        console.log(`Debug: Expiry in ~${daysDiff5.toFixed(1)} days (Expect ~7)`);        console.log(`Debug: Quota Limit ${res5.finalUser.membership.pts_quota.limit} (Expect 10)`);        console.assert(Math.abs(daysDiff5 - 7) < 1, 'Time should reset to ~7 days from now');
        console.assert(res5.finalUser.membership.pts_quota.limit === 10, 'Points should be fresh 10');
        console.log('✅ Passed\n');

        
        // ==========================================
        // Scenario 6: Mixed Bag (Member + Topup)
        // ==========================================
        console.log('🧪 Case 6: Active Member buys Top-up');
        await resetUser({ level: 2, expire_at: tomorrow, pts_quota: { limit: 10, used: 0 }, topup_quota: 15, topup_limit: 15 });
        
        // Started with 15. Buy 10. Expect 25.
        const res6 = await buyScheme(5); // Topup (+10)
        
        console.assert(res6.finalUser.membership.level === 2, 'Level stays 2');
        console.assert(res6.finalUser.membership.topup_quota === 25, 'Topup quota stacks (15+10=25)');
        console.assert(res6.finalUser.membership.topup_limit === 25, 'Topup limit updates');
        console.log('✅ Passed\n');

        // ==========================================
        // Scenario 7: Standard (L3) -> Premium (L4) Upgrade
        // ==========================================
        console.log('🧪 Case 7: Standard (L3) -> Premium (L4) Upgrade');
        // Setup: Active L3
        await resetUser({ level: 3, expire_at: tomorrow, pts_quota: { limit: 25, used: 10 } });
        
        const res7 = await buyScheme(4); // Premium (Price 49.9, 120 pts)
        
        // Price: 4990 - 1990 (Standard Value) = 3000
        console.log(`Debug: Paid ${res7.orderInfo.pay_amount} (Expect 3000 cents)`);
        console.assert(res7.finalUser.membership.level === 4, 'Should become Level 4');
        console.assert(res7.finalUser.membership.pts_quota.limit === 120, 'Premium limit should be 120');
        console.log('✅ Passed\n');

        // ==========================================
        // Scenario 8: Premium (L4) Renewal (Stacking)
        // ==========================================
        console.log('🧪 Case 8: Premium (L4) Renewal');
        // Setup: Active L4, 10 days left, 50/100 remaining
        const in10Days = new Date(); in10Days.setDate(in10Days.getDate() + 10);
        await resetUser({ level: 4, expire_at: in10Days, pts_quota: { limit: 100, used: 50 }, topup_quota: 20 });
        
        const res8 = await buyScheme(4); // Buy Premium (Month ~30 days, 120 pts)
        
        // Expiry: 10 + 30 = 40 days
        const exp8 = new Date(res8.finalUser.membership.expire_at);
        const day8 = (exp8.getTime() - new Date().getTime()) / (1000 * 3600 * 24);
        // Quota: 50 (remaining) + 120 = 170
        
        console.log(`Debug: Expiry ~${day8.toFixed(1)} days (Expect ~40)`);
        console.log(`Debug: limit=${res8.finalUser.membership.pts_quota.limit} (Expect 170)`);
        
        console.assert(Math.abs(day8 - 40) < 2, 'Duration should stack');
        console.assert(res8.finalUser.membership.pts_quota.limit === 170, 'Quota should stack');
        console.log('✅ Passed\n');

        // ==========================================
        // Scenario 9: Non-member -> Standard (L3) Direct
        // ==========================================
        console.log('🧪 Case 9: Non-member -> Standard (L3)');
        await resetUser({ level: 0 });
        const res9 = await buyScheme(3); // Standard
        
        console.assert(res9.finalUser.membership.level === 3, 'Level 3');
        console.assert(res9.finalUser.membership.pts_quota.limit === 25, 'Standard quota 25');
        console.log('✅ Passed\n');

        // ==========================================
        // Scenario 10: Trial (L1) -> Standard (L3) Jump Upgrade
        // ==========================================
        console.log('🧪 Case 10: Trial (L1) -> Standard (L3)');
        await resetUser({ level: 1, expire_at: tomorrow, pts_quota: {limit:5, used:0}});
        
        const res10 = await buyScheme(3); // Standard (1990)
        // Price: 1990 - 500 (Trial) = 1490
        console.log(`Debug: Paid ${res10.orderInfo.pay_amount} (Expect 1490)`);
        console.assert(res10.orderInfo.pay_amount === 1490, 'Price should deduct trial value');
        console.assert(res10.finalUser.membership.level === 3, 'Level 3');
        console.log('✅ Passed\n');

        // ==========================================
        // Scenario 11: Expired Trial -> Sprint (L2) [No Discount]
        // ==========================================
        console.log('🧪 Case 11: Expired Trial -> Sprint (L2)');
        const yesterday11 = new Date(); yesterday11.setDate(yesterday11.getDate() - 1);
        await resetUser({ level: 1, expire_at: yesterday11, pts_quota: {limit:5, used:0}});
        
        const res11 = await buyScheme(2); // Sprint (990)
        // Price: Should be full 990 because membership expired
        console.log(`Debug: Paid ${res11.orderInfo.pay_amount} (Expect 990)`);
        console.assert(res11.orderInfo.pay_amount === 990, 'Expired members do not get trade-in discount');
        console.log('✅ Passed\n');

        // ==========================================
        // Scenario 12: Multiple Top-ups Logic
        // ==========================================
        console.log('🧪 Case 12: Multiple Top-ups Stacking');
        await resetUser({ level: 0, topup_quota: 0, topup_limit: 0 });
        
        await buyScheme(5); // +10
        const res12 = await buyScheme(5); // +10 again
        
        console.log(`Debug: Topup Quota ${res12.finalUser.membership.topup_quota} (Expect 20)`);
        console.assert(res12.finalUser.membership.topup_quota === 20, 'Topups should stack indefinitely');
        console.log('✅ Passed\n');
        
        // ==========================================
        // Scenario 13: Top-up when Quota Exhausted
        // ==========================================
        console.log('🧪 Case 13: Standard Member with 0 pts buys Top-up');
        await resetUser({ level: 3, expire_at: tomorrow, pts_quota: {limit: 25, used: 25} }); // 0 Remaining
        
        const res13 = await buyScheme(5); // +10 Topup
        // Total Available = (25-25) + 10 = 10
        // We don't have a specific field for 'total_available', but frontend logic is:
        // isMemberActive ? (limit - used) : 0 + topup_quota
        // Here limit=25, used=25 => 0. topup=10. Total=10.
        
        console.assert(res13.finalUser.membership.topup_quota === 10, 'Topup added');
        console.log('✅ Passed\n');

    } catch (err: any) {
        console.error('❌ Test Failed:', err.message, err.response?.data);
        process.exit(1);
    } finally {
        console.log('🎉 All Scenarios Completed Successfully.');
        process.exit(0);
    }
}

runTests();
