import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { generateToken } from './utils';
import { StatusCode, StatusMessage } from '../../constants/statusCodes';

const router = Router();

router.post('/loginByOpenid', async (req: Request, res: Response) => {
  try {
    const { openid } = req.body;

    if (!openid) {
      return res.status(400).json({ 
        success: false, 
        code: StatusCode.INVALID_PARAMS,
        message: 'OpenID is required' 
      });
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
      return res.status(404).json({ 
        success: false, 
        code: StatusCode.USER_NOT_FOUND,
        message: StatusMessage[StatusCode.USER_NOT_FOUND]
      });
    }

    // Generate Token
    const token = generateToken({ 
        userId: user._id.toString(), 
        phoneNumber: user.phone || user.phoneNumber || '' 
    });

    res.json({
      success: true,
      result: {
        token,
        user: {
          _id: user._id,
          phone: user.phone || user.phoneNumber,
          phoneNumber: user.phone || user.phoneNumber,
          openids: user.openids || [user.openid],
          language: user.language || 'AIChinese',
          nickname: user.nickname || '',
          avatar: user.avatar || '',
          membership: user.membership || { level: 0 },
          inviteCode: user.inviteCode || '',
          resume_profile: user.resume_profile || {},
          isAuthed: !!(user.phone || user.phoneNumber)
        }
      }
    });

  } catch (error) {
    console.error('[Auth] LoginByOpenid error:', error);
    res.status(500).json({ 
      success: false, 
      code: StatusCode.INTERNAL_ERROR,
      message: StatusMessage[StatusCode.INTERNAL_ERROR]
    });
  }
});

export default router;
