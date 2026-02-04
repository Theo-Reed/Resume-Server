import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { comparePassword, generateToken } from './utils';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, password, openid } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ success: false, message: 'Phone number and password are required' });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    // 1. Find user by phone
    const user = await usersCol.findOne({ phoneNumber });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    }

    // 2. Verify password
    // If user has no password (migrated user?), we might need a flow to set it, but for now assume new flow
    if (!user.password) {
       return res.status(401).json({ success: false, message: 'Password not set. Please reset password.' });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });
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
      data: {
        token,
        user: {
          _id: user._id,
          phoneNumber: user.phoneNumber,
          openids: updatedOpenids,
          profile: user.profile
        }
      }
    });

  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
