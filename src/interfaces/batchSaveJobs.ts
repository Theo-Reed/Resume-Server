import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

/**
 * Batch save jobs for a user
 * POST /api/batchSaveJobs
 */
router.post('/batchSaveJobs', async (req: Request, res: Response) => {
  try {
    const { jobIds, jobData } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid || !jobIds || !Array.isArray(jobIds)) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    const db = getDb();
    const savedJobsCol = db.collection('saved_jobs');

    // 1. Find already saved jobs to avoid duplicates
    const alreadySaved = await savedJobsCol.find({
      openid,
      jobId: { $in: jobIds }
    }).project({ jobId: 1 }).toArray();

    const alreadySavedIds = new Set(alreadySaved.map(s => s.jobId));
    const newJobsToSave = jobIds.filter(id => !alreadySavedIds.has(id));

    if (newJobsToSave.length === 0) {
      return res.json({
        success: true,
        result: {
          success: true,
          savedCount: 0
        }
      });
    }

    // 2. Insert new saved jobs
    const documents = newJobsToSave.map(id => ({
      openid,
      jobId: id,
      type: jobData[id]?.type || '',
      createdAt: new Date(),
      sourceUpdatedAt: jobData[id]?.createdAt ? new Date(jobData[id].createdAt) : new Date()
    }));

    const result = await savedJobsCol.insertMany(documents);

    res.json({
      success: true,
      result: {
        success: true,
        savedCount: result.insertedCount
      }
    });
  } catch (error) {
    console.error('batchSaveJobs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;