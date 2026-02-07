import { OrderRepository, UserRepository, SchemeRepository, IUser, IScheme } from '../repositories';

/**
 * Domain Service: Membership Logic
 * Encapsulates all business rules regarding membership lifecycle, upgrades, and expirations.
 */
export class MembershipDomainService {
    
    /**
     * Core Business Logic: Calculate new subscription state
     * Pure function (mostly) - deterministic based on inputs.
     */
    static calculateNewState(currentUser: IUser, scheme: IScheme, now: Date = new Date()) {
        const currentMembership = (currentUser as any).membership || {};
        const isMemberActive = currentMembership.expire_at && new Date(currentMembership.expire_at) > now;
        const currentLevel = currentMembership.level || 0;
        const targetLevel = scheme.level;

        // DB Alignment: 'days' takes precedence, then 'duration_days', fallback to 30
        const durationDays = scheme.days !== undefined ? scheme.days : (scheme.duration_days !== undefined ? scheme.duration_days : 30); 
        const durationMs = durationDays * 24 * 60 * 60 * 1000;
        const pointsToAdd = scheme.points || 0;

        let newExpireAt: Date | null = null;
        let finalLevel = targetLevel;
        let finalName = scheme.name_chinese || scheme.name;
        let finalType = scheme.type;

        // --- Rules Engine ---
        if (scheme.type === 'topup') {
            // [Rule 1]: Top-up (Add points/days to EXISTING membership)
            // Does not change the "Level" or "Type" of membership unless it's a specific promotion
            finalLevel = currentLevel;
            finalName = currentMembership.name || 'Standard';
            finalType = currentMembership.type || 'standard';

            if (durationDays > 0) {
                 // Extend existing expiry or start from now
                 const currentExpire = (isMemberActive && currentMembership.expire_at) ? new Date(currentMembership.expire_at) : now;
                 const baseTime = currentExpire > now ? currentExpire : now;
                 newExpireAt = new Date(baseTime.getTime() + durationMs);
            } else {
                 newExpireAt = null;
            }

        } else if (isMemberActive && targetLevel === currentLevel) {
            // [Rule 2]: Renewal (Same Level) -> Extend Expiry
            const currentExpire = new Date(currentMembership.expire_at);
            const baseTime = currentExpire > now ? currentExpire : now;
            newExpireAt = new Date(baseTime.getTime() + durationMs);

        } else {
            // [Rule 3]: New Subscription or Upgrade/Downgrade -> Reset/Start Fresh
            // Note: Currently, downgrades/upgrades reset the clock. 
            // Better logic might be to carry over pro-rated value, but "Start Fresh" is safer for v1.
            newExpireAt = new Date(now.getTime() + durationMs);
        }

        return {
            newExpireAt,
            pointsToAdd,
            membershipData: {
                'membership.level': finalLevel,
                'membership.name': finalName,
                'membership.type': finalType,
                'membership.updatedAt': now,
                ...(newExpireAt !== null && newExpireAt !== undefined ? { 'membership.expire_at': newExpireAt } : {})
            }
        };
    }

    /**
     * Domain Logic: pricing calculation
     */
    static calculatePrice(currentUser: IUser, targetScheme: IScheme, currentSchemeDetails?: IScheme) {
        const currentMembership = (currentUser as any).membership || {};
        const isMemberActive = currentMembership.expire_at && new Date(currentMembership.expire_at) > new Date();
        const currentLevel = currentMembership.level || 0;
        const targetLevel = targetScheme.level;

        let payAmount = targetScheme.price;
        let orderType = targetScheme.type;

        // [Rule: Upgrade Discount]
        // If active member wants higher tier, they pay difference
        if (targetScheme.type !== 'topup' && isMemberActive && targetLevel > currentLevel) {
            orderType = 'upgrade';
            const deduction = currentSchemeDetails ? currentSchemeDetails.price : 0;
            // Floor at 1 cent
            payAmount = Math.max(1, targetScheme.price - deduction);
        }

        return { payAmount, orderType };
    }
}

/**
 * Application Service: Orchestrates the activation flow.
 * Uses Repositories for data access and DomainService for logic.
 */
export const activateMembershipByOrder = async (orderId: string) => {
    console.log(`[MembershipAppService] Processing Activation for Order: ${orderId}`);

    // 1. [Atomic Lock]: ACQUIRE ownership of this order
    // Ensure only one worker processes this specific order.
    const order = await OrderRepository.acquirePaidLock(orderId);

    // 2. [Idempotency Check]: If lock failed, check if it was already processed
    if (!order) {
        // Double-check the current state to return the correct user object (Idempotent response)
        const existingOrder = await OrderRepository.findById(orderId);
        if (existingOrder && existingOrder.status === 'paid') {
            console.log(`[MembershipAppService] Order ${orderId} already settled. Returning idempotent result.`);
            return await UserRepository.findByOpenidOrId(existingOrder.openid, existingOrder.userId);
        }
        throw new Error(`Order ${orderId} cannot be processed (Status: ${existingOrder?.status})`);
    }

    try {
        // 3. [Data Retrieval]: Get Reference Data
        const [scheme, user] = await Promise.all([
            SchemeRepository.findBySchemeId(order.scheme_id),
            UserRepository.findByOpenidOrId(order.openid, order.userId)
        ]);

        if (!scheme) throw new Error(`Scheme ${order.scheme_id} missing`);
        if (!user) throw new Error(`User ${order.openid} missing`);

        // 4. [Domain Logic]: Calculate Effects
        const { membershipData, pointsToAdd } = MembershipDomainService.calculateNewState(user, scheme);

        // 5. [Persistence]: Commit Changes
        const updateOp = {
            $set: membershipData,
            $inc: { 'membership.pts_quota.limit': pointsToAdd }
        };

        console.log('[MembershipAppService] Committing User State:', JSON.stringify(updateOp));
        await UserRepository.updateMembership(user._id, updateOp);

        // 6. [Final Return]
        return await UserRepository.findByOpenidOrId(order.openid, user._id);

    } catch (error) {
        // Critical Error Handling: If we claimed the order but failed to give goods,
        // we technically should roll back the order status or alert an admin.
        // For MongoDB (no multi-doc transactions in standalone), we log FATAL.
        console.error(`[FATAL] Order ${orderId} marked paid but activation failed:`, error);
        // Attempt fallback? OrderRepository.markAsFailed(orderId, error.message);
        throw error;
    }
};
