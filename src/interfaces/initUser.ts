import { Router, Request, Response } from 'express';
import { ensureUser } from '../userUtils';

const router = Router();

// Used in: app.ts
router.post('/initUser', async (req: Request, res: Response) => {
  try {
    const { userInfo } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid || openid === 'undefined') {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing OpenID' });
    }
    
    const user = await ensureUser(openid, userInfo);

    if (!user) {
      return res.status(500).json({ success: false, message: 'User initialization failed' });
    }
    
    res.json({
      success: true, 
      result: {
        openid: (user as any).openid,
        user: user
      }
    });
  } catch (error) {
    console.error('initUser error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
