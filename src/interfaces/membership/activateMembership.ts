import { Router, Request, Response } from 'express';
import { activateMembershipByOrder } from '../../services/membershipService';

const router = Router();

// Used in: pages/me/index.ts (after payment success)
router.post('/activateMembership', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ success: false, message: 'Missing order_id' });

    const user = await activateMembershipByOrder(order_id);

    res.json({
      success: true,
      result: {
        user
      }
    });
  } catch (error: any) {
    console.error('activateMembership error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
