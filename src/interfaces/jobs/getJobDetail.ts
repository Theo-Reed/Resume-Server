import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ObjectId } from 'mongodb';

const router = Router();

router.post('/getJobDetail', async (req: Request, res: Response) => {
  try {
    const { id, collection = 'remote_jobs' } = req.body;
    
    if (!id) {
        return res.status(400).json({ success: false, message: 'Missing id' });
    }

    const db = getDb();
    
    // Validate collection name to prevent security issues
    const allowedCollections = ['remote_jobs', 'custom_jobs'];
    const targetCollection = allowedCollections.includes(collection) ? collection : 'remote_jobs';

    let job;
    try {
        job = await db.collection(targetCollection).findOne({ _id: id });
    } catch (e) {
        // Try looking up by ObjectId just in case ID is passed as string but stored as Object ID
        try {
           job = await db.collection(targetCollection).findOne({ _id: new ObjectId(id) });
        } catch (ignored) {}
    }

    if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found' });
    }

    res.json({
        success: true,
        result: job
    });

  } catch (error) {
    console.error('getJobDetail error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

export default router;
