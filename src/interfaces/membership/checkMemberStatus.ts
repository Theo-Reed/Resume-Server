import { Router, Request, Response } from 'express';
import { UserRepository } from '../../repositories';

const router = Router();

/**
 * [Big Tech Architecture] Fetch user membership overview.
 */
router.post('/checkMemberStatus', async (req: Request, res: Response) => {
  try {
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const user = await UserRepository.findByOpenidOrId(openid);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      result: {
        inviteCode: user.inviteCode,
        hasUsedInviteCode: user.hasUsedInviteCode,
        isAuthed: !!(user.phone || user.phoneNumber),
        membership: user.membership || {
          level: 0,
          expire_at: null,
          pts_quota: { limit: 0, used: 0 }
        }
      }
    });
  } catch (error: any) {
    console.error('[CheckMemberStatus] Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}); 

export default router;
