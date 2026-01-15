import { Router, Request, Response } from 'express';

const router = Router();

// Used in: pages/job-detail/index.ts
router.post('/saveJob', async (req: Request, res: Response) => {
  try {
    const { jobId, type, createdAt } = req.body;
    // const openid = ...

    // Logic:
    // Insert into 'saved_jobs' table
    
    res.json({
      success: true,
      result: {
        _id: 'new_saved_job_id',
        errMsg: 'collection.add:ok'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
