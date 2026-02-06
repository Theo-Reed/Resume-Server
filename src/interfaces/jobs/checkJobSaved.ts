import { Router, Request, Response } from 'express';
import { getDb } from '../../db';

const router = Router();

// Used in: pages/job-detail/index.ts
router.post('/checkJobSaved', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body;
    const phoneNumber = (req as any).user.phoneNumber;

    if (!phoneNumber || !jobId) {
        return res.json({ success: true, result: { exists: false } });
    }

    const db = getDb();
    const saved = await db.collection('saved_jobs').findOne({ phoneNumber, jobId });
    
    res.json({
      success: true,
      result: {
        exists: !!saved,
        _id: saved ? saved._id : null
      }
    });
  } catch (error) {
    console.error('checkJobSaved error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
