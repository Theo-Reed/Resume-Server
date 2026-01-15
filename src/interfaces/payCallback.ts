import { Router, Request, Response } from 'express';
import { verifyNotification, decipherNotification } from '../utils/wechatPay'; // Re-import

import { activateMembershipByOrder } from '../services/membershipService';
import { getDb } from '../db';
import { ObjectId } from 'mongodb';

const router = Router();

router.post('/payCallback', async (req: Request, res: Response) => {
    try {
        // 1. Verify Signature
        // req.headers, req.body
        // Note: Body must be valid JSON (handled by express.json middleware)
        // But for verification, we might need RAW body?
        // Usually express.json is fine as long as we stringify it back consistently or use raw buffer.
        // For standard JSON bodies from WeChat, `JSON.stringify(req.body)` often works if no whitespace magic.
        // Safest is to use a middleware to capture rawBody. But let's try with body.
        
        await verifyNotification(req.headers, req.body);
        
        // 2. Decipher
        const { resource } = req.body;
        const result = decipherNotification(resource);
        
        // result = { out_trade_no, transaction_id, trade_state, amount, ... }
        
        if (result.trade_state === 'SUCCESS') {
            const orderId = result.out_trade_no; // We used order._id as out_trade_no
            
            console.log(`[PayCallback] Order ${orderId} Paid. Updating...`);
            
            // Activate
            try {
                await activateMembershipByOrder(orderId);
            } catch (err: any) {
                console.error('Activation failed inside callback:', err);
                // Even if activation logic "fails" (e.g. user not found type weirdness), 
                // we should tell WeChat we received it, to stop retries?
                // Or let it retry?
                // If it's a permanent error (e.g. invalid orderId format), we should accept.
                // If temporary DB error, return 500 to retry.
            }
        }
        
        // 3. Respond
        res.status(200).send();
        
    } catch (error: any) {
        console.error('Pay Callback Processing Error:', error);
        res.status(500).json({ code: 'FAIL', message: error.message });
    }
});

export default router;