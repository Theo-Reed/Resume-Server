import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ensureUser } from '../../userUtils';

const router = Router();

// Used in: pages/me/index.ts, utils/phoneAuth.ts
router.post('/updateUserProfile', async (req: Request, res: Response) => {
  try {
    const { phone, isAuthed, nickname, avatar } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    const updateFields: any = {};
    if (phone !== undefined) updateFields.phone = phone;
    if (isAuthed !== undefined) updateFields.isAuthed = isAuthed;
    
    // Accept name and map to nickname
    if (nickname !== undefined) updateFields.nickname = nickname;
    if (avatar !== undefined) updateFields.avatar = avatar;

    // Handle resume_profile updates (flatten if needed to preserve other fields)
    if (req.body.resume_profile) {
      const rp = req.body.resume_profile;
      for (const key in rp) {
        updateFields[`resume_profile.${key}`] = rp[key];
      }
    }

    const result = await usersCol.findOneAndUpdate(
      { openid },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({
      success: true,
      result: {
        user: result
      }
    });
  } catch (error) {
    console.error('updateUserProfile error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
