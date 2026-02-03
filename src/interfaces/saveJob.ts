import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// Used in: pages/job-detail/index.ts
router.post('/saveJob', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body;
    const openid = req.headers['x-openid'] as string;

    if (!openid || !jobId) {
      return res.status(400).json({ success: false, message: 'Missing openid or jobId' });
    }

    const db = getDb();
    await db.collection('saved_jobs').updateOne(
        { openid, jobId },
        { 
            $set: { 
                openid, 
                jobId, 
                createdAt: new Date() 
            } 
        },
        { upsert: true }
    );
    
    res.json({
      success: true,
      result: {
        errMsg: 'collection.add:ok'
      }
    });
  } catch (error: any) {
    console.error('saveJob error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
