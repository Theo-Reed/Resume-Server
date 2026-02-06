import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ensureUser, isTestUser } from '../../userUtils';
import { ObjectId } from 'mongodb';

import { hasWxConfig, getMiniProgramPaymentParams } from '../../wechat-pay';

const router = Router();

// Used in: pages/me/index.ts
router.post('/createOrder', async (req: Request, res: Response) => {
  try {
    const { scheme_id } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = getDb();
    const schemesCol = db.collection('member_schemes');
    const ordersCol = db.collection('orders');
    
    // 1. Get Scheme
    const scheme = await schemesCol.findOne({ scheme_id: Number(scheme_id) });
    if (!scheme) return res.status(400).json({ success: false, message: 'Invalid Scheme' });

    // 2. Get User for Upgrade Logic
    const user: any = await ensureUser(openid);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    let payAmount = scheme.price;
    let orderType = scheme.type; // 'sprint', 'standard', 'ultimate', 'topup'

    // --- Pricing Logic ---
    const now = new Date();
    const currentMembership = user.membership || {};
    const isMemberActive = currentMembership.expire_at && new Date(currentMembership.expire_at) > now;
    const currentLevel = currentMembership.level || 0;
    const targetLevel = scheme.level;

    // Special Logic: Test Users pay 1 cent (0.01 CNY)
    const testUser = await isTestUser(openid);
    if (testUser) {
        payAmount = 1; 
        orderType = 'test';
    } else if (scheme.type !== 'topup' && isMemberActive && targetLevel > currentLevel) {
        // Upgrade Logic: Higher level subscription + Currently Active
        orderType = 'upgrade';
        
        // Find current scheme for deduction
        const currentScheme = await schemesCol.findOne({ level: currentLevel, type: { $ne: 'topup' } });
        const deduction = currentScheme ? currentScheme.price : 0;

        // Calculate upgrade price (with a minimum floor of 1 cent for WeChat Pay)
        payAmount = Math.max(1, scheme.price - deduction);
    }
    // Note: Same level or Topup or Expired user pays full price (since they stack or restart)

    // 3. Check for existing UNPAID order for reuse
    const existingOrder = await ordersCol.findOne({
        openid,
        scheme_id: scheme.scheme_id,
        status: 'pending',
        pay_amount: payAmount
    });

    if (existingOrder && (existingOrder as any).paymentParams) {
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

    // 4. Create Order
    const createdAt = new Date();
    const expireAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000); // 2 hours TTL (match WeChat prepay_id)

    const order = {
        _id: new ObjectId(),
        openid,
        scheme_id: scheme.scheme_id,
        scheme_name: (scheme.name_chinese || scheme.name),
        type: orderType,
        original_amount: scheme.price,
        pay_amount: payAmount,
        status: 'pending',
        createdAt,
        expireAt
    };
    
    // --- Generate Payment Params ---
    let paymentParams;
    
    if (hasWxConfig()) {
        try {
            paymentParams = await getMiniProgramPaymentParams(
                `Membership-${(scheme.name_chinese || scheme.name)}`,
                order._id.toString(),
                { total: payAmount, currency: 'CNY' },
                openid
            );
        } catch (err: any) {
            console.error('WeChat Pay Generation Error:', err);
            return res.status(500).json({ success: false, message: 'Payment init failed: ' + err.message });
        }
    } else {
        // Mock Payment Params for Dev/Test
        paymentParams = {
            timeStamp: Math.floor(Date.now() / 1000).toString(),
            nonceStr: 'mock_' + order._id.toString().slice(-6),
            package: 'prepay_id=mock_' + order._id.toString(),
            signType: 'RSA',
            paySign: 'mock_sign'
        };
    }

    // Save with payment params for future reuse
    (order as any).paymentParams = paymentParams;
    await ordersCol.insertOne(order);

    res.json({
      success: true,
      result: {
        order_id: order._id.toString(),
        pay_amount: payAmount, 
        payment: paymentParams
      }
    });
  } catch (error: any) {
    console.error('createOrder error:', error);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error: ' + error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}); 

export default router;
