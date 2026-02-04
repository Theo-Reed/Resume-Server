import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { generateToken } from './utils';

const router = Router();

router.post('/loginByOpenid', async (req: Request, res: Response) => {
  try {
    const { openid } = req.body;

    if (!openid) {
      return res.status(400).json({ success: false, message: 'OpenID is required' });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    // Find user where openids array contains the openid
    // OR legacy 'openid' field matches
    const user = await usersCol.findOne({
      $or: [
        { openids: openid },
        { openid: openid }
      ]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Generate Token
    const token = generateToken({ 
        userId: user._id.toString(), 
        phoneNumber: user.phoneNumber || '' 
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          _id: user._id,
          phoneNumber: user.phoneNumber,
          openids: user.openids || [user.openid],
          profile: user.profile
        }
      }
    });

  } catch (error) {
    console.error('[Auth] LoginByOpenid error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
