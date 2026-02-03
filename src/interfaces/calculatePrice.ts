import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { ensureUser } from '../userUtils';

const router = Router();

// Used in: pages/me/index.ts to preview price before creating order
router.post('/calculatePrice', async (req: Request, res: Response) => {
  try {
    const { scheme_id } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = getDb();
    const schemesCol = db.collection('member_schemes');
    
    // 1. Get Scheme
    const scheme = await schemesCol.findOne({ scheme_id: Number(scheme_id) });
    if (!scheme) return res.status(400).json({ success: false, message: 'Invalid Scheme' });

    // 2. Get User
    const user: any = await ensureUser(openid);
    let payAmount = scheme.price;
    let isUpgrade = false;

    // --- Pricing Logic (Sync with createOrder.ts) ---
    const now = new Date();
    const currentMembership = user.membership || {};
    const isMemberActive = currentMembership.expire_at && new Date(currentMembership.expire_at) > now;
    const currentLevel = currentMembership.level || 0;
    const targetLevel = scheme.level;

    if (scheme.type !== 'topup' && isMemberActive && targetLevel > currentLevel) {
        let deduction = 0;
        if (currentLevel === 1) deduction = 990;   // Value of Trial
        if (currentLevel === 2) deduction = 1990;  // Value of Sprint card
        if (currentLevel === 3) deduction = 8990;  // Value of Standard card (Monthly)

        payAmount = Math.max(1, scheme.price - deduction);
        isUpgrade = true;
    }

    res.json({
      success: true,
      result: {
        success: true,
        originalPrice: scheme.price,
        finalPrice: payAmount,
        isUpgrade: isUpgrade,
        discountAmount: scheme.price - payAmount
      }
    });
  } catch (error) {
    console.error('calculatePrice error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}); 

export default router;
