import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { ensureUser } from '../userUtils';
import { ObjectId } from 'mongodb';

import { hasWxConfig, getMiniProgramPaymentParams } from '../wechat-pay';

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

    // Upgrade Logic: Higher level subscription + Currently Active
    if (scheme.type !== 'topup' && isMemberActive && targetLevel > currentLevel) {
        orderType = 'upgrade';
        
        // Find current scheme for deduction
        const currentScheme = await schemesCol.findOne({ level: currentLevel, type: { $ne: 'topup' } });
        const deduction = currentScheme ? currentScheme.price : 0;

        // Calculate upgrade price (with a minimum floor of 1 cent for WeChat Pay)
        payAmount = Math.max(1, scheme.price - deduction);
    }
    // Note: Same level or Topup or Expired user pays full price (since they stack or restart)

    // 3. Create Order
    const order = {
        _id: new ObjectId(),
        openid,
        scheme_id: scheme.scheme_id,
        scheme_name: (scheme.name_chinese || scheme.name),
        type: orderType,
        original_amount: scheme.price,
        pay_amount: payAmount,
        status: 'pending',
        createdAt: new Date()
    };
    
    await ordersCol.insertOne(order);

    // --- Generate Payment Params ---
    let paymentParams;
    
    if (hasWxConfig()) {
        try {
            // Amount in CENTS for WeChat Pay? SDK usually takes CNY units if object has currency, but standard is cents?
            // wechatpay-node-v3 expects amount: { total, currency }
            // total is int (cents).
            
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
        // Mock Payment Params for Dev/Test (Cases 1-13)
        paymentParams = {
            timeStamp: Date.now().toString(),
            nonceStr: 'mock',
            package: 'prepay_id=mock',
            signType: 'MD5',
            paySign: 'mock'
        };
    }

    res.json({
      success: true,
      result: {
        success: true,
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
