import { Router, Request, Response } from 'express';

const router = Router();

// Used in: pages/job-detail/index.ts
router.post('/unsaveJob', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body;
    // const openid = ...

    // Logic:
    // Delete from 'saved_jobs' where userId = openid AND jobId = jobId
    
    res.json({
      success: true,
      result: { success: true }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
