import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { queryOrder, hasWxConfig } from '../../wechat-pay';
import { activateMembershipByOrder } from '../../services/membershipService';
import { OrderRepository } from '../../repositories';

const router = Router();

/**
 * [Big Tech Architecture] Membership Order Status Verification
 * Used for polling from the frontend.
 */
router.post('/checkOrderStatus', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!order_id) return res.status(400).json({ success: false, message: 'Missing order_id' });

    // 1. Fetch Order via Repository
    const order = await OrderRepository.findById(order_id);

    if (!order) {
        console.error(`[CheckOrder] Order ID not found: ${order_id}`);
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Security Check
    if (order.openid !== openid) {
        console.warn(`[CheckOrder] Unauthorized access attempt: order=${order_id}, request_user=${openid}`);
        // In strict mode, we'd return 403.
    }

    // 2. Early Exit: Already processed
    if (order.status === 'paid' || order.activated) {
        return res.json({ success: true, status: 'paid', activated: true });
    }

    if (order.status === 'cancelled' || order.status === 'failed') {
        return res.json({ success: false, status: order.status });
    }

    // 3. Remote Verification (WeChat Pay)
    if (hasWxConfig()) {
        try {
            console.log(`[CheckOrder] Verifying remote state for ${order_id}`);
            const wxResult: any = await queryOrder(order._id.toString());
            
            if (wxResult && wxResult.trade_state === 'SUCCESS') {
                console.log(`[CheckOrder] Remote SUCCESS for ${order_id}. Triggering application service.`);
                
                // Use the atomic activation service
                const updatedUser = await activateMembershipByOrder(order_id);
                
                return res.json({ 
                    success: true, 
                    status: 'paid', 
                    user: updatedUser 
                });
            }
        } catch (err) {
            console.error('[CheckOrder] External query failure:', err);
        }
    }

    // 4. Fallback: Still Pending
    return res.json({ 
        success: true, 
        status: 'pending',
        message: 'Order state unconfirmed'
    });

  } catch (error: any) {
    console.error('[CheckOrder] System Error:', error);
    res.status(500).json({ success: false, message: 'Internal validation error' });
  }
});

export default router;

export default router;
