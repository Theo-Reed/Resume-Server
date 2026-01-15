import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// Used in: components/job-tab/index.ts
router.post('/getPublicJobList', async (req: Request, res: Response) => {
  try {
    const { pageSize = 10, skip = 0, source_name, salary, experience, language } = req.body;
    const db = getDb();
    
    // 构建查询条件
    const query: any = { type: '国内' };
    if (source_name) query.source_name = source_name;
    // 增加其他过滤条件逻辑...

    const jobs = await db.collection('remote_jobs')
      .find(query)
      .skip(skip)
      .limit(pageSize)
      .toArray();

    res.json({
      success: true,
      result: {
        ok: true,
        jobs: jobs
      }
    });
  } catch (error) {
    console.error('getPublicJobList error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
