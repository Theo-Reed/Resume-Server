import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// Used in: components/job-tab/index.ts
router.post('/searchJobs', async (req: Request, res: Response) => {
  try {
    const { keyword, skip = 0, limit = 10, tabType, drawerFilter, language } = req.body;
    const db = getDb();
    
    const query: any = {};

    // 根据 tabType 过滤区域
    if (tabType === 0) {
      query.type = '国内';
    } else if (tabType === 1) {
      query.type = { $in: ['国外', 'web3'] };
    }

    if (keyword) {
      query.$or = [
        { title: { $regex: keyword, $options: 'i' } },
        { title_chinese: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } }
      ];
    }
    
    // TODO: 实现更多 drawerFilter 逻辑

    const jobs = await db.collection('remote_jobs')
      .find(query)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      result: {
        jobs: jobs
      }
    });
  } catch (error) {
    console.error('searchJobs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
