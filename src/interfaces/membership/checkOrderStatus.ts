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
        _id: new ObjectId(order_id),
        openid: openid 
    });

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 1. Check DB Status
    if (order.status === 'paid' || order.status === 'completed') {
        return res.json({ success: true, status: 'paid', message: 'Order already paid' });
    }

    if (order.status === 'cancelled') {
        return res.json({ success: false, status: 'cancelled', message: 'Order was cancelled' });
    }

    // 2. Check WeChat Pay if still pending and we have config
    if (hasWxConfig()) {
        try {
            // queryOrder returns the WeChat Pay query result object
            // status field in result.trade_state: SUCCESS, REFUND, NOTPAY, CLOSED, REVOKED, USERPAYING, PAYERROR
            const wxResult = await queryOrder(order._id.toString());
            
            if (wxResult && wxResult.trade_state === 'SUCCESS') {
                console.log(`[CheckOrder] Found paid order via Query: ${order_id}. Activating...`);
                
                // Triggers activation + DB update
                await activateMembershipByOrder(order_id);
                
                return res.json({ success: true, status: 'paid', message: 'Order verified and paid' });
            } else if (wxResult && (wxResult.trade_state === 'CLOSED' || wxResult.trade_state === 'REVOKED' || wxResult.trade_state === 'PAYERROR')) {
                 // Update to cancelled/failed locally to stop polling
                 await ordersCol.updateOne({ _id: order._id }, { $set: { status: 'failed', checkReason: wxResult.trade_state_desc } });
                 return res.json({ success: false, status: 'failed', message: 'Payment failed or closed' });
            }
        } catch (err) {
            console.error('[CheckOrder] Error querying WeChat Pay:', err);
            // Don't fail the request, just return pending state (network error etc)
        }
    }

    // Still pending
    return res.json({ success: true, status: 'pending', message: 'Order is pending' });

  } catch (error: any) {
    console.error('checkOrderStatus error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
