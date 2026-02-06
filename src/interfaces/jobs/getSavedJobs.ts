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
    // Using a more robust pipeline that handles both string and ObjectId, 
    // and checks both remote_jobs and custom_jobs collections.
    const pipeline = [
      { $match: { phoneNumber } },
      { $sort: { createdAt: -1 } },
      { $skip: Number(skip) },
      { $limit: Number(limit) },
      {
        $lookup: {
          from: 'remote_jobs',
          let: { sjJobId: '$jobId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$sjJobId'] },
                    // Safely try ObjectId conversion only if length is 24
                    {
                      $and: [
                        { $eq: [{ $type: '$_id' }, 'objectId'] },
                        { $eq: [{ $strLenCP: '$$sjJobId' }, 24] },
                        { $eq: ['$_id', { $toObjectId: '$$sjJobId' }] }
                      ]
                    }
                  ]
                }
              }
            }
          ],
          as: 'remote_details'
        }
      },
      {
        $lookup: {
          from: 'custom_jobs',
          let: { sjJobId: '$jobId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$sjJobId'] },
                    {
                      $and: [
                        { $eq: [{ $type: '$_id' }, 'objectId'] },
                        { $eq: [{ $strLenCP: '$$sjJobId' }, 24] },
                        { $eq: ['$_id', { $toObjectId: '$$sjJobId' }] }
                      ]
                    }
                  ]
                }
              }
            }
          ],
          as: 'custom_details'
        }
      },
      {
        $addFields: {
          job_details: {
            $ifNull: [
              { $arrayElemAt: ['$remote_details', 0] },
              { $arrayElemAt: ['$custom_details', 0] }
            ]
          }
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
            savedAt: sj.createdAt,
            // 确保这些字段存在，即使在 custom_jobs 中可能缺失
            _id: sj.job_details._id || sj.jobId,
            type: sj.job_details.type || sj.type || 'remote'
        }))
      }
    });
  } catch (error: any) {
    console.error('getSavedJobs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
