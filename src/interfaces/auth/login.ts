import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { comparePassword, generateToken } from './utils';
import { formatUserResponse } from '../../userUtils';
import { StatusCode, StatusMessage } from '../../constants/statusCodes';

const router = Router();

router.post('/loginByPhone', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, password, openid } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ 
        success: false, 
        code: StatusCode.INVALID_PARAMS,
        message: 'Phone number and password are required' 
      });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    // 1. Find user by phone
    const user = await usersCol.findOne({ phoneNumber });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        code: StatusCode.INVALID_CREDENTIALS,
        message: StatusMessage[StatusCode.INVALID_CREDENTIALS]
      });
    }

    // 2. Verify password
    // If user has no password (migrated user?), we might need a flow to set it, but for now assume new flow
    if (!user.password) {
       return res.status(401).json({ 
         success: false, 
         code: StatusCode.INVALID_CREDENTIALS,
         message: '未设置密码，请联系管理员或重置密码' 
       });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        code: StatusCode.INVALID_CREDENTIALS,
        message: StatusMessage[StatusCode.INVALID_CREDENTIALS]
      });
    }

    // 3. Handle OpenID Binding (Stealing Logic)
    let updatedOpenids = user.openids || [];
    if (openid) {
      // Check if openid is already in the list
      if (!updatedOpenids.includes(openid)) {
        // A. Remove from ANY other user
        await usersCol.updateMany(
            { openids: openid, _id: { $ne: user._id } },
            { $pull: { openids: openid } as any }
        );
        // Also legacy fields
        await usersCol.updateMany(
            { openid: openid, _id: { $ne: user._id } },
            { $unset: { openid: "" } }
        );

        // B. Add to current user
        await usersCol.updateOne(
            { _id: user._id },
            { $addToSet: { openids: openid } as any }
        );
        
        updatedOpenids.push(openid);
      }
    }

    // 4. Generate Token
    const token = generateToken({ userId: user._id.toString(), phoneNumber: user.phoneNumber });

    res.json({
      success: true,
      code: StatusCode.SUCCESS,
      result: {
        token,
        user: formatUserResponse(user)
      }
    });

  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ 
      success: false, 
      code: StatusCode.INTERNAL_ERROR,
      message: 'Internal server error' 
    });
  }
});

export default router;
