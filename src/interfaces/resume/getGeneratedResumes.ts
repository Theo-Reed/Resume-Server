import { Router, Request, Response } from 'express';
import { getDb } from '../../db';

const router = Router();

router.post('/getGeneratedResumes', async (req: Request, res: Response) => {
  try {
    const { jobId, status, task_id, limit = 20, skip = 0 } = req.body;
    
    // 使用 JWT 中的手机号
    const phoneNumber = (req as any).user.phoneNumber;
    if (!phoneNumber) {
       return res.status(401).json({ success: false, message: 'Unauthorized: Missing phoneNumber' });
    }

    const db = getDb();
    const collection = db.collection('generated_resumes');
    
    // 统一使用 phoneNumber 查询
    const query: any = { phoneNumber };

    if (jobId) {
        query.jobId = jobId;
    }
    if (status) {
        query.status = status;
    }
    if (task_id) {
        query.task_id = task_id;
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
            items: resumes,
            total
        }
    });

  } catch (error) {
    console.error('getGeneratedResumes error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

export default router;
