import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { ensureUser } from '../userUtils';

const router = Router();

// Used in: miniprogram/components/job-tab/index.ts
router.post('/saveSearchCondition', async (req: Request, res: Response) => {
  try {
    const { openid, searchKeyword, drawerFilter, tabIndex } = req.body;
    
    // Ensure openid is provided or authenticated
    const finalOpenid = req.headers['x-openid'] as string || openid;

    if (!finalOpenid) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const db = getDb();
    const collection = db.collection('saved_search_conditions');
    
    const timestamp = Date.now();
    
    const result = await collection.insertOne({
        openid: finalOpenid,
        searchKeyword,
        drawerFilter,
        tabIndex,
        createdAt: timestamp,
        updatedAt: timestamp
    });

    res.json({
      success: true,
      result: {
        _id: result.insertedId,
        ok: 1
      }
    });
  } catch (error) {
    console.error('Error saving search condition:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
