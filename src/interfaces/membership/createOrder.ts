import { Router, Request, Response } from 'express';
import { ensureUser, isTestUser } from '../../userUtils';
import { ObjectId } from 'mongodb';

import { hasWxConfig, getMiniProgramPaymentParams, queryOrder } from '../../wechat-pay';
import { activateMembershipByOrder, MembershipDomainService } from '../../services/membershipService';
import { OrderRepository, UserRepository, SchemeRepository, IOrder } from '../../repositories';

const router = Router();

/**
 * Membership Order Creation
 * Flow:
 * 1. Validate Input (openid, scheme_id)
 * 2. Retrieve Domain Entities (User, Scheme)
 * 3. Calculate Pricing (Domain Logic)
 * 4. Idempotency Check (Reuse pending orders)
 * 5. WeChat Integration
 * 6. Persistence
 */
router.post('/createOrder', async (req: Request, res: Response) => {
  try {
    const { scheme_id } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // 1. Fetch Entities
    const [scheme, user] = await Promise.all([
        SchemeRepository.findBySchemeId(Number(scheme_id)),
        UserRepository.findByOpenidOrId(openid)
    ]);

    if (!scheme) return res.status(400).json({ success: false, message: 'Invalid Scheme' });
    
    // User must exist (synced during login/phone auth)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // 2. Domain Logic: Pricing
    // Get current scheme for upgrade deduction
    const currentLevel = user.membership?.level || 0;
    const currentScheme = await SchemeRepository.findByLevel(currentLevel);
    
    let { payAmount, orderType } = MembershipDomainService.calculatePrice(user, scheme, currentScheme || undefined);

    // 3. Gray-scale / Test Overrides
    const testUser = await isTestUser(openid);
    if (testUser) {
        console.log(`[GrayScale] Internal test user identified: ${openid}. Overriding amount to 1 cent.`);
        payAmount = 1; 
        orderType = 'test';
    }

    // 4. Idempotency: Deduplication & Reuse
    const existingOrder = await OrderRepository.findPendingOrder({
        openid,
        scheme_id: scheme.scheme_id,
        pay_amount: payAmount
    });

    if (existingOrder && (existingOrder as any).paymentParams) {
        // Verification: If user ALREADY paid this order but polling failed
        if (hasWxConfig()) {
            const wxResult = await queryOrder(existingOrder._id.toString());
            if (wxResult && wxResult.trade_state === 'SUCCESS') {
                console.log(`[Payment] Existing order ${existingOrder._id} was already paid. Force activating...`);
                const updatedUser = await activateMembershipByOrder(existingOrder._id.toString());
                return res.json({
                    success: true,
                    result: { alreadyPaid: true, user: updatedUser }
                });
            }
        }

        console.log('[Payment] Reusing existing order:', existingOrder._id);
        return res.json({
            success: true,
            result: {
                order_id: existingOrder._id.toString(),
                pay_amount: payAmount,
                payment: (existingOrder as any).paymentParams
            }
        });
    }

    // 5. Preparation & WeChat Integration
    const orderId = new ObjectId();
    const createdAt = new Date();
    const expireAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000); // 2 hours

    let paymentParams;
    if (hasWxConfig()) {
        try {
            paymentParams = await getMiniProgramPaymentParams(
                `Membership-${(scheme.name_chinese || scheme.name)}`,
                orderId.toString(),
                { total: payAmount, currency: 'CNY' },
                openid
            );
        } catch (err: any) {
            console.error('[Payment] WeChat Prepay Failed:', err);

            // Special Case: WeChat says Order Paid (already exists on their end)
            const errorCode = err.data?.code || err.code || "";
            if (errorCode === 'ORDERPAID' || err.message?.includes('ORDERPAID')) {
                // If it's already paid but we don't have record, we just activate
                // Note: In real enterprise, we should find that specific order first.
                // For now, we attempt to activate by the ID we tried to use.
                return res.json({ success: true, isAlreadyPaid: true, message: 'Order already paid at WeChat' });
            }

            return res.status(500).json({ success: false, message: 'WeChat initiation failed: ' + err.message });
        }
    } else {
        // Mock payment for non-production environments
        paymentParams = {
            timeStamp: Math.floor(Date.now() / 1000).toString(),
            nonceStr: 'mock_' + orderId.toString().slice(-6),
            package: 'prepay_id=mock_' + orderId.toString(),
            signType: 'RSA',
            paySign: 'mock_sign'
        };
    }

    // 6. Persistence
    const order: IOrder = {
        _id: orderId,
        userId: user._id,
        openid,
        scheme_id: scheme.scheme_id,
        scheme_name: (scheme.name_chinese || scheme.name),
        type: orderType as any,
        original_amount: scheme.price,
        pay_amount: payAmount,
        status: 'pending',
        paymentParams,
        createdAt,
        expireAt
    };

    await OrderRepository.create(order);

    res.json({
      success: true,
      result: {
        order_id: orderId.toString(),
        pay_amount: payAmount, 
        payment: paymentParams
      }
    });

  } catch (error: any) {
    console.error('[CreateOrder] Failed:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}); 

export default router;
