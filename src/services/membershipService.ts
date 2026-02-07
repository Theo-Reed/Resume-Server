import { getDb } from '../db';
import { ObjectId } from 'mongodb';

export const activateMembershipByOrder = async (orderId: string) => {
    const db = getDb();
    const ordersCol = db.collection('orders');
    const schemesCol = db.collection('member_schemes');
    const usersCol = db.collection('users');

    // 1. Get Order with state check
    const order = await ordersCol.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
        console.error(`[Membership] Order ${orderId} not found`);
        throw new Error('Order not found');
    }

    // Idempotency check: if order is already paid, don't process again
    if (order.status === 'paid') {
        console.log(`[Membership] Order ${orderId} already processed. Skipping.`);
        // Try to find user by userId first, fallback to openid logic
        const userQuery = order.userId ? { _id: order.userId } : { $or: [{ openid: order.openid }, { openids: order.openid }] };
        return await usersCol.findOne(userQuery);
    }
    
    // 2. Get Scheme
    const scheme = await schemesCol.findOne({ scheme_id: order.scheme_id });
    if (!scheme) {
        console.error(`[Membership] Scheme ${order.scheme_id} not found for order ${orderId}`);
        throw new Error('Scheme not found');
    }
    
    // 3. Update User
    const userQuery = order.userId ? { _id: order.userId } : { $or: [{ openid: order.openid }, { openids: order.openid }] };
    const user = await usersCol.findOne(userQuery);
    
    if (!user) {
        console.error(`[Membership] User ${order.openid} / ${order.userId} not found for order ${orderId}`);
        throw new Error('User not found');
    }

    const update: any = {};
    const now = new Date();
    const currentMembership = (user as any).membership || {};
    
    // --- Activate Logic ---
    const isMemberActive = currentMembership.expire_at && new Date(currentMembership.expire_at) > now;
    const currentLevel = currentMembership.level || 0;
    const targetLevel = scheme.level;
    
    // Fix: db uses 'days' not 'duration_days'
    const durationDays = scheme.days || scheme.duration_days || 30; 
    const durationMs = durationDays * 24 * 60 * 60 * 1000;
    const pointsToAdd = scheme.points || 0;

    let newExpireAt: Date;

    // Handle Expiration Logic
    if (scheme.type === 'topup') {
        // Top-up: Does not change expiration unless it has days (usually days=0)
        // If it has days (e.g. 7 day pass + points), it might extend.
        // If days=0, keep existing expiration.
        if (durationDays > 0) {
             const currentExpire = (isMemberActive && currentMembership.expire_at) ? new Date(currentMembership.expire_at) : now;
             const baseTime = currentExpire > now ? currentExpire : now;
             newExpireAt = new Date(baseTime.getTime() + durationMs);
        } else {
             newExpireAt = (isMemberActive && currentMembership.expire_at) ? new Date(currentMembership.expire_at) : null; // Keep existing or null
        }
    } else if (isMemberActive && targetLevel === currentLevel) {
        // Renewal (Same Level) -> Extend
        const currentExpire = new Date(currentMembership.expire_at);
        const baseTime = currentExpire > now ? currentExpire : now;
        newExpireAt = new Date(baseTime.getTime() + durationMs);
    } else {
        // New / Upgrade -> Start Fresh from Now
        newExpireAt = new Date(now.getTime() + durationMs);
    }

    /* Update Membership Object */
    update.$set = {
        'membership.level': (scheme.type === 'topup') ? currentLevel : targetLevel, // Topup maintains level
        'membership.name': (scheme.type === 'topup') ? currentMembership.name : (scheme.name_chinese || scheme.name),
        'membership.type': (scheme.type === 'topup') ? currentMembership.type : scheme.type,
        'membership.updatedAt': now
    };
    
    // Only update expiry if calculated (Topup might not change it)
    if (newExpireAt) {
        update.$set['membership.expire_at'] = newExpireAt;
    }
    
    // Add Points (using $inc for atomic update if we could, but here we building $set/inc object)
    // Note: MongoDB allows mixing $set and $inc in one updateOne
    update.$inc = {
        'membership.pts_quota.limit': pointsToAdd
    };

    // Update User
    await usersCol.updateOne({ _id: user._id }, update);
    
    // Update Order Status and REMOVE expireAt to prevent TTL deletion
    await ordersCol.updateOne(
        { _id: new ObjectId(orderId) }, 
        { 
            $set: { status: 'paid', paidAt: new Date() },
            $unset: { expireAt: "" } 
        }
    );

    return await usersCol.findOne({ openid: order.openid });
};
