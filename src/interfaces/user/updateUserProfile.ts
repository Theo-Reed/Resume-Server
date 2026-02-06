import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ensureUser, evaluateResumeCompleteness } from '../../userUtils';

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
      { 
        $or: [
          { openids: openid },
          { openid: openid }
        ]
      },
      { $set: updateFields },
      { returnDocument: 'after', includeResultMetadata: false }
    );

    // After updating to MongoDB Driver 6.x+, findOneAndUpdate returns the document directly
    // unless includeResultMetadata is true. But to be 100% safe across environments:
    const updatedUser: any = (result as any)?.value !== undefined ? (result as any).value : result;

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 重新计算完整度并静默存入数据库
    const profile = updatedUser.resume_profile || {};
    const completenessUpdates: any = {};
    
    // Ensure we are evaluating the latest data by merging the newly updated fields 
    // if the document returned by MongoDB was somehow stale (though 'after' should prevent this)
    const zhProfile = profile.zh || {};
    const enProfile = profile.en || {};

    const zhRes = evaluateResumeCompleteness(zhProfile, 'zh');
    completenessUpdates['resume_profile.zh.completeness'] = zhRes;
    
    const enRes = evaluateResumeCompleteness(enProfile, 'en');
    completenessUpdates['resume_profile.en.completeness'] = enRes;

    // 额外的兼容性顶层字段更新 (可选，为了兼容旧代码)
    completenessUpdates['resume_percent'] = zhRes.score;
    completenessUpdates['resume_completeness'] = zhRes.level;
    completenessUpdates['resume_percent_en'] = enRes.score;
    completenessUpdates['resume_completeness_en'] = enRes.level;

    const secondUpdate = await usersCol.findOneAndUpdate(
      { _id: updatedUser._id },
      { $set: completenessUpdates },
      { returnDocument: 'after', includeResultMetadata: false }
    );

    const finalUser = (secondUpdate as any)?.value !== undefined ? (secondUpdate as any).value : (secondUpdate || updatedUser);
    
    res.json({
      success: true,
      result: {
        user: finalUser
      }
    });
  } catch (error) {
    console.error('updateUserProfile error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
