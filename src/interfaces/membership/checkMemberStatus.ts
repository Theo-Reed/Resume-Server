import { Router, Request, Response } from 'express';
import { ensureUser } from '../../userUtils';

const router = Router();

// Used in: app.ts
router.post('/checkMemberStatus', async (req: Request, res: Response) => {
  try {
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing OpenID' });
    }

    const user = await ensureUser(openid);
    
    if (!user) {
      return res.status(500).json({ success: false, message: 'User initialization failed' });
    }

    res.json({
      success: true,
      result: {
        inviteCode: (user as any).inviteCode,
        hasUsedInviteCode: (user as any).hasUsedInviteCode,
        isAuthed: !!((user as any).phone || (user as any).phoneNumber),
        membership: (user as any).membership || {
          level: 0,
          expire_at: null,
          pts_quota: { limit: 0, used: 0 }
        }
      }
    });
  } catch (error) {
    console.error('checkMemberStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
