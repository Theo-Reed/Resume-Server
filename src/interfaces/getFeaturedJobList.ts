import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// Used in: components/job-tab/index.ts
router.post('/getFeaturedJobList', async (req: Request, res: Response) => {
  try {
    const { pageSize = 10, skip = 0, source_name, salary, experience, language } = req.body;
    const db = getDb();

    // Logic:
    // Query 'remote_jobs' table
    // Apply filters: type IN ('国外', 'web3') or similar logic for featured
    const query: any = { type: { $in: ['国外', 'web3'] } };
    if (source_name) query.source_name = source_name;

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
    console.error('getFeaturedJobList error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
