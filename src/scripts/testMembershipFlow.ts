
import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'puppet-resume';

// Mock dependencies if needed, or just import the service
// Since I want to test the service logic, I'll import it.
// However, the service uses `getDb()`, so I need to make sure `db` is initialized.
// I will just copy the logic or import the service if I can initialize the db it uses.

// The service imports `getDb` from `../db`. I need to make sure `connectToLocalMongo` is called.
import { connectToLocalMongo, closeLocalMongo } from '../db';
import { activateMembershipByOrder } from '../services/membershipService';

const TEST_OPENID = 'TEST_USER_MEMBERSHIP_FLOW';

async function runTest() {
    console.log('🚀 Starting Membership Flow Test...');
    console.log(`ℹ️  Connecting to DB: ${process.env.MONGODB_URI}`);
    
    let db;
    try {
        db = await connectToLocalMongo();
    } catch (e) {
        console.error('❌ Failed to connect to MongoDB. Please check your .env file and VPN/Network settings.');
        console.error('   Running this test requires access to the database specified in MONGODB_URI.');
        process.exit(1);
    }
    
    const usersCol = db.collection('users');
    const schemesCol = db.collection('member_schemes');
    const ordersCol = db.collection('orders');

    // --- Cleanup ---
    await usersCol.deleteOne({ openid: TEST_OPENID });
    await ordersCol.deleteMany({ openid: TEST_OPENID });
    await schemesCol.deleteMany({ scheme_id: { $in: [999, 1000] } });

    // --- Setup Data ---
    // 1. Create User
    const user = {
        _id: new ObjectId(),
        openid: TEST_OPENID,
        name: 'Test User',
        createdAt: new Date(),
        membership: {} 
    };
    await usersCol.insertOne(user);
    console.log('✅ Test User Created');

    // 2. Create Schemes
    // Scheme 999: Standard 1 Month (Normal)
    await schemesCol.insertOne({
        scheme_id: 999,
        name: 'Standard Monthly',
        type: 'standard',
        level: 1,
        price: 100, // 1.00 CNY
        days: 30,
        points: 25
    });
    // Scheme 1000: Pro 1 Month (Upgrade)
    await schemesCol.insertOne({
        scheme_id: 1000,
        name: 'Pro Monthly',
        type: 'pro',
        level: 2,
        price: 200, // 2.00 CNY
        days: 30,
        points: 100
    });
    // Scheme 1001: Points Top-up
    await schemesCol.insertOne({
        scheme_id: 1001,
        name: 'Points Stack',
        type: 'topup',
        level: 0,
        price: 50,
        days: 0,
        points: 50
    });
    console.log('✅ Test Schemes Created');

    try {
        // ==========================================
        // SCENARIO 1: First Purchase (Standard)
        // ==========================================
        console.log('\n--- Scenario 1: First Purchase ---');
        const order1 = {
            _id: new ObjectId(),
            userId: user._id,
            openid: TEST_OPENID,
            scheme_id: 999,
            pay_amount: 100,
            status: 'pending',
            createdAt: new Date()
        };
        // Insert as pending
        await ordersCol.insertOne({ ...order1, status: 'pending' });

        // Call Service
        await activateMembershipByOrder(order1._id.toString());

        // Verify
        let userAfter = await usersCol.findOne({ openid: TEST_OPENID }) as any;
        let membership = userAfter.membership;
        
        console.log('Membership after Purchase:', membership);
        
        if (membership.level !== 1) throw new Error('Level should be 1');
        if (membership.pts_quota.limit !== 25) throw new Error(`Points should be 25, got ${membership.pts_quota.limit}`);
        
        // Check Expiration (approx 30 days from now)
        const now = new Date();
        let diffDays = (new Date(membership.expire_at).getTime() - now.getTime()) / (1000 * 3600 * 24);
        console.log(`Expires in ${diffDays.toFixed(2)} days`);

        if (diffDays < 29 || diffDays > 31) throw new Error('Expiration date incorrect for 30 days');


        // ==========================================
        // SCENARIO 2: Points Top-up (Should not change expiry dates/level, just points)
        // ==========================================
        console.log('\n--- Scenario 2: Points Topup ---');
        const orderTopup = {
            _id: new ObjectId(),
            userId: user._id,
            openid: TEST_OPENID,
            scheme_id: 1001,
            pay_amount: 50,
            createdAt: new Date()
        };
        await ordersCol.insertOne({ ...orderTopup, status: 'pending' });
        
        await activateMembershipByOrder(orderTopup._id.toString());
        
        userAfter = await usersCol.findOne({ openid: TEST_OPENID }) as any;
        membership = userAfter.membership;
        
        console.log('Membership after Topup:', membership);
        if (membership.level !== 1) throw new Error('Level should NOT change');
        if (membership.pts_quota.limit !== 75) throw new Error(`Points should be 75 (25+50), got ${membership.pts_quota.limit}`);
        
        diffDays = (new Date(membership.expire_at).getTime() - now.getTime()) / (1000 * 3600 * 24);
        if (diffDays < 29 || diffDays > 31) throw new Error('Expiration date should NOT change significantly');


        // ==========================================
        // SCENARIO 3: Renewal (Same Level)
        // ==========================================
        console.log('\n--- Scenario 3: Renewal (Standard) ---');
        // Add another 30 days
        const order2 = {
            _id: new ObjectId(),
            userId: user._id,
            openid: TEST_OPENID,
            scheme_id: 999,
            pay_amount: 100,
            createdAt: new Date()
        };
        await ordersCol.insertOne({ ...order2, status: 'pending' });
        
        await activateMembershipByOrder(order2._id.toString());
        
        userAfter = await usersCol.findOne({ openid: TEST_OPENID }) as any;
        membership = userAfter.membership;
        
        const diffDays2 = (new Date(membership.expire_at).getTime() - now.getTime()) / (1000 * 3600 * 24);
        console.log(`Expires in ${diffDays2.toFixed(3)} days (Should be ~60)`);
        
        if (membership.pts_quota.limit !== 100) throw new Error(`Points should be 100 (75+25), got ${membership.pts_quota.limit}`);
        if (diffDays2 < 58 || diffDays2 > 62) throw new Error('Expiration date incorrect for renewal (should stack)');


        // ==========================================
        // SCENARIO 4: Upgrade (Level 1 -> Level 2)
        // ==========================================
        console.log('\n--- Scenario 4: Upgrade ---');
        
        const order3 = {
            _id: new ObjectId(),
            userId: user._id,
            openid: TEST_OPENID,
            scheme_id: 1000,
            pay_amount: 100, // Reduced price
            createdAt: new Date()
        };
        await ordersCol.insertOne({ ...order3, status: 'pending' });

        await activateMembershipByOrder(order3._id.toString());
        
        userAfter = await usersCol.findOne({ openid: TEST_OPENID }) as any;
        membership = userAfter.membership;
        
        console.log('Membership after Upgrade:', membership);
        
        if (membership.level !== 2) throw new Error('Level should be 2');
        if (membership.pts_quota.limit !== 200) throw new Error(`Points should be 200 (100+100), got ${membership.pts_quota.limit}`);

        // Expiration for Upgrade: resets to 30 days from NOW (according to implementation)
        const diffDays3 = (new Date(membership.expire_at).getTime() - now.getTime()) / (1000 * 3600 * 24);
        if (diffDays3 > 32) throw new Error(`Expiration should be reset to ~30 days for upgrade, got ${diffDays3} days`);
        
        console.log('✅ All Scenarios Passed');

    } catch (e) {
        console.error('❌ Test Failed:', e);
    } finally {
        await closeLocalMongo();
    }
}

runTest();
