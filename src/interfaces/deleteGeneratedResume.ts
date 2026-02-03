import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

router.post('/deleteGeneratedResume', async (req: Request, res: Response) => {
  try {
    const { openid, resumeId } = req.body;
    
    const headers = req.headers;
    const effectiveOpenId = (headers['x-openid'] as string) || openid;
    if (!effectiveOpenId) {
       return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!resumeId) {
        return res.status(400).json({ success: false, message: 'Missing resumeId' });
    }

    const db = getDb();
    const collection = db.collection('generated_resumes');
    
    // Convert string ID to ObjectId if needed
    let queryId;
    try {
        queryId = new ObjectId(resumeId);
    } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid resumeId format' });
    }

    // 1. Find the resume verify ownership
    const resume = await collection.findOne({ 
        _id: queryId,
        openid: effectiveOpenId
    });

    if (!resume) {
        return res.status(404).json({ success: false, message: 'Resume not found or unauthorized' });
    }

    // 2. Delete the file from filesystem if it exists
    if (resume.fileUrl) {
        // fileUrl is like "/public/resumes/xxx.pdf"
        // Ensure path stays within public/resumes to prevent path traversal
        const fileName = path.basename(resume.fileUrl);
        const fullPath = path.join(process.cwd(), 'public', 'resumes', fileName);
        
        console.log(`[Delete] Attempting to delete file: ${fullPath}`);
        
        if (fs.existsSync(fullPath)) {
            try {
                fs.unlinkSync(fullPath);
                console.log(`[Delete] File deleted successfully`);
            } catch (fsError) {
                console.error(`[Delete] Failed to delete file: ${fsError}`);
                // We continue to delete the record even if file deletion fails
            }
        } else {
             console.log(`[Delete] File not found at ${fullPath}, skipping fs delete`);
        }
    }

    // 3. Delete from database
    await collection.deleteOne({ _id: queryId });

    res.json({
        success: true,
        message: 'Resume deleted successfully'
    });

  } catch (error: any) {
    console.error('deleteGeneratedResume error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
    });
  }
});

export default router;
