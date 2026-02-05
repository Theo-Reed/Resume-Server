import { Router, Request, Response } from 'express';

import { getDb } from '../../db';

const router = Router();

// Used in: app.ts
router.post('/updateUserLanguage', async (req: Request, res: Response) => {
  try {
    const { language } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid || openid === 'undefined') {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing OpenID' });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    // Update by matching either field
    const query = {
        $or: [
            { openid: openid },
            { openids: openid }
        ]
    };

    await usersCol.updateOne(
        query,
        { $set: { language, updatedAt: new Date() } }
    );
    
    const user = await usersCol.findOne(query);

    res.json({
      success: true,
      result: {
        user
      }
    });
  } catch (error) {
    console.error('updateUserLanguage error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
