import { Router, Request, Response } from 'express';
import { verifyNotification, decipherNotification } from '../../wechat-pay';
import { activateMembershipByOrder } from '../../services/membershipService';

const router = Router();

router.post('/payCallback', async (req: Request, res: Response) => {
  try {
    console.log('[PayCallback] Received notification');
    
    // Use rawBody if available (set in server.ts via express.json verify)
    // fallen back to req.body if not.
    const bodyToVerify = (req as any).rawBody || req.body;
    
    // 1. Verify Signature
    let decoded: any;
    try {
        await verifyNotification(req.headers, bodyToVerify);
        
        // 2. Decipher Resource
        const { resource } = req.body;
        decoded = decipherNotification(resource);
    } catch (verifyErr: any) {
        console.error('[PayCallback] Verification failed:', verifyErr.message);
        return res.status(401).json({ code: 'FAIL', message: 'Signature verification failed' });
    }
    
    console.log('[PayCallback] Decoded event:', JSON.stringify(decoded));

    // 3. Process Success state
    if (decoded && (decoded.trade_state === 'SUCCESS' || decoded.event_type === 'TRANSACTION.SUCCESS')) {
      const order_id = decoded.out_trade_no || (decoded.resource && decoded.resource.out_trade_no);
      if (order_id) {
          console.log(`[PayCallback] Payment success for order: ${order_id}. Activating...`);
          await activateMembershipByOrder(order_id);
      } else {
          console.warn('[PayCallback] No out_trade_no found in decoded resource', decoded);
      }
    }

    // Always return success to WeChat if verification passed to stop retries
    res.json({ code: 'SUCCESS', message: 'OK' });
  } catch (error: any) {
    console.error('[PayCallback] Internal Error:', error);
  }
});

export default router;
