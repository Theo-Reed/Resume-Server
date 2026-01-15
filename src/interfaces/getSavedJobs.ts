import { Router, Request, Response } from 'express';

const router = Router();

// Used in: components/job-tab/index.ts
router.post('/getSavedJobs', async (req: Request, res: Response) => {
  try {
    const { skip, limit, openid } = req.body;

    // Logic:
    // 1. Query 'saved_jobs' table where userId = openid
    // 2. Get list of jobIds
    // 3. Query 'remote_jobs' table WHERE id IN (jobIds)
    // 4. Join data and return
    
    res.json({
      success: true,
      result: {
        jobs: [
            // { ...jobData, savedAt: ... }
        ] 
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
