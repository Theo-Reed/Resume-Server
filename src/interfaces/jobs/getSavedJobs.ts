import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ObjectId } from 'mongodb';

const router = Router();

// Used in: components/job-tab/index.ts
router.post('/getSavedJobs', async (req: Request, res: Response) => {
  try {
    const { skip = 0, limit = 20 } = req.body;
    const phoneNumber = (req as any).user.phoneNumber;

    if (!phoneNumber) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing phoneNumber' });
    }

    const db = getDb();
    
    // Step 1: Find all saved jobs for this user by phoneNumber
    const pipeline = [
      { $match: { phoneNumber } },
      { $sort: { createdAt: -1 } },
      { $skip: Number(skip) },
      { $limit: Number(limit) },
      {
        $lookup: {
          from: 'remote_jobs',
          let: { jobId: '$jobId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', { $toObjectId: '$$jobId' }] },
                    { $eq: ['$_id', '$$jobId'] }
                  ]
                }
              }
            }
          ],
          as: 'job_details'
        }
      },
      { $unwind: { path: '$job_details', preserveNullAndEmptyArrays: false } }
    ];

    const savedJobs = await db.collection('saved_jobs').aggregate(pipeline).toArray();

    res.json({
      success: true,
      result: {
        jobs: savedJobs.map(sj => ({
            ...sj.job_details,
            savedAt: sj.createdAt
        }))
      }
    });
  } catch (error: any) {
    console.error('getSavedJobs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
