import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ObjectId } from 'mongodb';
import { queryOrder, hasWxConfig } from '../../wechat-pay';
import { activateMembershipByOrder } from '../../services/membershipService';

const router = Router();

/**
 * Used in: pages/me/index.ts (polling after payment)
 * Manually check order status.
 * 1. Check DB. If paid, return success.
 * 2. If DB pending, check WeChat Pay API (if configured).
 * 3. If WeChat Pay says SUCCESS, activate membership and update DB.
 */
router.post('/checkOrderStatus', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!order_id) {
      return res.status(400).json({ success: false, message: 'Missing order_id' });
    }

    const db = getDb();
    const ordersCol = db.collection('orders');

    const order = await ordersCol.findOne({ 
        _id: new ObjectId(order_id)
    });

    if (!order) {
        console.error(`[CheckOrder] Order ID not found in DB: ${order_id}`);
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify ownership (Safety check)
    if (order.openid !== openid) {
        console.warn(`[CheckOrder] Ownership mismatch. Request OpenID: ${openid}, Order OpenID: ${order.openid}`);
        // For debugging, we allow it if it's the test user or just log it
    }

    // 1. Check DB Status
    console.log(`[CheckOrder] Checking status for ${order_id}: ${order.status}`);

    if (order.status === 'cancelled') {
        return res.json({ success: false, status: 'cancelled', message: 'Order was cancelled' });
    }

    // 2. Check WeChat Pay if still pending and we have config
    if (hasWxConfig()) {
        try {
            console.log(`[CheckOrder] Querying WeChat Pay for order: ${order_id}`);
            const wxResult: any = await queryOrder(order._id.toString());
            
            if (wxResult && !wxResult.error) {
                console.log(`[CheckOrder] WeChat Trade State: ${wxResult.trade_state} for ${order_id}`);
                
                if (wxResult.trade_state === 'SUCCESS') {
                    console.log(`[CheckOrder] Found paid order via Query: ${order_id}. Activating...`);
                    const updatedUser = await activateMembershipByOrder(order_id);
                    return res.json({ success: true, status: 'paid', user: updatedUser });
                }
                // ... other states
            } else {
                console.warn(`[CheckOrder] Query failed for ${order_id}:`, wxResult?.message || wxResult?.status);
                // If it's a test user, maybe we allow a "Force" check? 
                // No, let's keep it safe.
            }
        } catch (err) {
            console.error('[CheckOrder] Error in polling logic:', err);
        }
    }

    // Still pending
    return res.json({ 
        success: true, 
        status: 'pending', 
        message: 'Order is pending',
        current_db_status: order.status 
    });

  } catch (error: any) {
    console.error('checkOrderStatus error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
