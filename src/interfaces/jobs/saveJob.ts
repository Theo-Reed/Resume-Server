import { Router, Request, Response } from 'express';
import { getDb } from '../../db';

const router = Router();

// Used in: pages/job-detail/index.ts
router.post('/saveJob', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body;
    // 使用 phoneNumber 作为业务主键
    const phoneNumber = (req as any).user.phoneNumber;

    if (!phoneNumber || !jobId) {
      return res.status(400).json({ success: false, message: 'Missing phoneNumber or jobId' });
    }

    const db = getDb();
    await db.collection('saved_jobs').updateOne(
        { phoneNumber, jobId },
        { 
            $set: { 
                phoneNumber, 
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
