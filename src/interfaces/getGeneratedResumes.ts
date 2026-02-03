import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

router.post('/getGeneratedResumes', async (req: Request, res: Response) => {
  try {
    const { openid, jobId, status, limit = 20, skip = 0 } = req.body;
    
    const headers = req.headers;
    const effectiveOpenId = (headers['x-openid'] as string) || openid;
    if (!effectiveOpenId) {
       return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const db = getDb();
    const collection = db.collection('generated_resumes');
    
    // Standardized to openid
    const query: any = { openid: effectiveOpenId };

    if (jobId) {
        query.jobId = jobId;
    }
    if (status) {
        query.status = status;
    }

    const total = await collection.countDocuments(query);
    const resumes = await collection.find(query)
        .sort({ createTime: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .toArray();

    res.json({
        success: true,
        result: {
            data: resumes,
            total
        }
    });

  } catch (error) {
    console.error('getGeneratedResumes error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

export default router;
