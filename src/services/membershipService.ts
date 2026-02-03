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
        return await usersCol.findOne({ openid: order.openid });
    }
    
    // 2. Get Scheme
    const scheme = await schemesCol.findOne({ scheme_id: order.scheme_id });
    if (!scheme) {
        console.error(`[Membership] Scheme ${order.scheme_id} not found for order ${orderId}`);
        throw new Error('Scheme not found');
    }
    
    // 3. Update User
    const user = await usersCol.findOne({ openid: order.openid });
    if (!user) {
        console.error(`[Membership] User ${order.openid} not found for order ${orderId}`);
        throw new Error('User not found');
    }

    const update: any = {};
    const now = new Date();
    const currentMembership = (user as any).membership || {};

    if (scheme.type === 'topup') {
        // Add to topup_quota. (Permanent)
        update.$inc = { 
            'membership.topup_quota': scheme.points,
            'membership.topup_limit': scheme.points
        };
    } else {
        // --- Subscription Logic ---
        const currentLevel = currentMembership.level || 0;
        const newLevel = scheme.level;
        
        let finalExpireAt: Date;
        let newLimit: number;

        if (newLevel === currentLevel && currentMembership.expire_at) {
            // Renewal / Stacking
            const oldExpireAt = new Date(currentMembership.expire_at);
            const isNotExpired = oldExpireAt > now;
            const baseTime = isNotExpired ? oldExpireAt : now;
            finalExpireAt = new Date(baseTime.getTime() + scheme.days * 24 * 60 * 60 * 1000);
            
            if (isNotExpired) {
                const currentUsed = currentMembership.pts_quota?.used || 0;
                const currentLimit = currentMembership.pts_quota?.limit || 0;
                const remaining = Math.max(0, currentLimit - currentUsed);
                newLimit = remaining + scheme.points;
            } else {
                newLimit = scheme.points;
            }
        } else {
            // Upgrade or New
            finalExpireAt = new Date(now.getTime() + scheme.days * 24 * 60 * 60 * 1000);
            newLimit = scheme.points;
        }

        update.$set = {
            'membership.level': newLevel,
            'membership.expire_at': finalExpireAt,
            'membership.pts_quota': {
                limit: newLimit,
                used: 0
            }
        };
        
        update.$unset = {
            'membership.job_quota': '',
            'membership.resume_quota': '',
            'membership.expireTime': ''
        };
    }
    
    // Update User
    await usersCol.updateOne({ openid: order.openid }, update);
    
    // Update Order Status if not already
    await ordersCol.updateOne({ _id: new ObjectId(orderId) }, { $set: { status: 'paid', paidAt: new Date() } });

    return await usersCol.findOne({ openid: order.openid });
};
