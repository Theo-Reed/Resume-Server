import { Router, Request, Response } from 'express';
import { ensureUser } from '../userUtils';

const router = Router();

/**
 * Generate (or get) user's invite code
 * POST /api/generateInviteCode
 */
router.post('/generateInviteCode', async (req: Request, res: Response) => {
  try {
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await ensureUser(openid);
    
    if (!user) {
      return res.status(500).json({ success: false, message: 'Failed to generate invite code' });
    }

    res.json({
      success: true,
      result: {
        inviteCode: user.inviteCode
      }
    });
  } catch (error) {
    console.error('generateInviteCode error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;