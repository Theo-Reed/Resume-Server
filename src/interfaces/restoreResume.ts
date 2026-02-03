import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { ObjectId } from 'mongodb';
import { runBackgroundTask, TaskServices } from '../taskRunner';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

/**
 * 恢复简历逻辑：
 * 当物理文件被自动清理（24小时后）但用户想再次预览时，
 * 该接口利用 DB 中持久化的 enhancedData 重新触发渲染，
 * 绕过 AI 调用，实现“秒级恢复”。
 */
router.post('/restoreResume', async (req: Request, res: Response) => {
  try {
    const { openid, resumeId } = req.body;
    
    // 1. 验证权限
    const headers = req.headers;
    const effectiveOpenId = (headers['x-openid'] as string) || openid;
    if (!effectiveOpenId) {
       return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!resumeId) {
        return res.status(400).json({ success: false, message: 'Missing resumeId' });
    }

    const db = getDb();
    const resumesCollection = db.collection('generated_resumes');
    
    let queryId;
    try {
        queryId = new ObjectId(resumeId);
    } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid resumeId format' });
    }

    // 2. 查找记录
    const resume = await resumesCollection.findOne({ 
        _id: queryId,
        openid: effectiveOpenId
    });

    if (!resume) {
        return res.status(404).json({ success: false, message: 'Resume record not found' });
    }

    // 3. 检查物理文件是否真的不在了 (双重检查)
    if (resume.fileUrl) {
        const fileName = path.basename(resume.fileUrl);
        const filePath = path.join(process.cwd(), 'public', 'resumes', fileName);
        if (fs.existsSync(filePath)) {
            return res.json({ 
                success: true, 
                message: 'File actually exists', 
                status: 'completed',
                fileUrl: resume.fileUrl 
            });
        }
    }

    // 4. 核心逻辑：检查是否有 enhancedData 进行快速恢复
    if (!resume.enhancedData) {
        return res.status(400).json({ 
            success: false, 
            message: 'Original metadata expired or missing. Please use retry to generate a new one.' 
        });
    }

    const finalTaskId = resume.task_id || resume.taskId || `RESTORE_${Date.now()}`;
    console.log(`♻️  正在为 ${effectiveOpenId} 恢复简历 ${resumeId} (使用缓存数据，免AI)...`);

    // 5. 将状态重置为 processing
    await resumesCollection.updateOne(
        { _id: queryId },
        { 
            $set: { 
                status: 'processing', 
                task_id: finalTaskId,
                errorMessage: null,
                restoreTime: new Date()
            } 
        }
    );

    // 6. 构造 Payload (包含 explicit 的 enhancedData 触发 taskRunner 的跳过逻辑)
    const payload = {
        openid: effectiveOpenId,
        jobId: resume.jobId,
        resume_profile: resume.resumeInfo,
        job_data: resume.jobData,
        language: resume.language || 'chinese',
        enhancedData: resume.enhancedData // 关键：传入缓存好的数据
    };

    const taskServices: TaskServices = { db };
    runBackgroundTask(finalTaskId, payload as any, taskServices);

    res.json({
        success: true,
        message: 'Restoration task queued (Skip AI)',
        taskId: finalTaskId
    });

  } catch (error: any) {
    console.error('restoreResume error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
    });
  }
});

export default router;
