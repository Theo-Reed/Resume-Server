import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { ensureUser } from '../userUtils';
import { runBackgroundTask, TaskServices } from '../taskRunner';
import { GenerateFromFrontendRequest } from '../types';

const router = Router();
const COLLECTION_RESUMES = 'generated_resumes';

/**
 * 生成简历 PDF API
 * POST /api/generate
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const payload = req.body as GenerateFromFrontendRequest;
    const openid = req.headers['x-openid'] as string || payload.openid;

    if (!openid) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing OpenID' });
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: '数据库未就绪' });
    }

    // --- Concurrent Task Check Start ---
    const existingTask = await db.collection(COLLECTION_RESUMES).findOne({
      openid: openid,
      jobId: payload.jobId,
      status: 'processing'
    });

    if (existingTask) {
      // 检查任务是否已经超过 10 分钟
      const taskAgeMinutes = (Date.now() - new Date(existingTask.createTime).getTime()) / (1000 * 60);
      if (taskAgeMinutes > 10) {
        // 10分钟还没跑完，极大概率是服务器重启或进程崩了导致的僵死状态
        console.log(`⚠️ 发现僵死任务 ${existingTask.task_id} (已持续 ${taskAgeMinutes.toFixed(1)} 分钟)，自动清理并允许重新生成。`);
        await db.collection(COLLECTION_RESUMES).updateOne(
          { _id: existingTask._id }, 
          { $set: { status: 'failed', error: 'Task Timeout (Auto Cleaned)' } }
        );
      } else {
        return res.status(409).json({
          success: false,
          message: '该岗位的简历还在生成中，请耐心等待，无需重复提交。'
        });
      }
    }
    // --- Concurrent Task Check End ---

    // --- Quota Check Start ---
    const user = await ensureUser(openid);

    if (!user) {
      return res.status(500).json({ error: '无法通过用户校验' });
    }

    const membership = (user as any).membership || {};
    const quota = membership.pts_quota || { limit: 0, used: 0 };
    const topupBalance = membership.topup_quota || 0;
    const now = new Date();
    const isMemberActive = membership.expire_at && new Date(membership.expire_at) > now;

    let consumedType = '';

    if (isMemberActive && quota.used < quota.limit) {
      // Use Monthly Quota
      consumedType = 'monthly';
      await db.collection('users').updateOne(
        { openid: openid }, // Corrected to use openid variable
        { $inc: { 'membership.pts_quota.used': 1 } }
      );
    } else if (topupBalance > 0) {
      // Use Top-up Quota
      consumedType = 'topup';
      await db.collection('users').updateOne(
        { openid: openid }, // Corrected to use openid variable
        { $inc: { 'membership.topup_quota': -1 } }
      );
    } else {
      // Quota Exhausted
      return res.status(403).json({ 
        success: false,
        error: 'Quota exhausted', 
        message: '您的算力点数已耗尽或会员已过期，请前往会员中心充值。' 
      });
    }
    // --- Quota Check End ---

    // 1. 生成唯一 Task ID
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const taskId = `RESUME_${dateStr}_${randomUUID().slice(0, 8)}`;

    // 2. 预先入库（立即执行）
    console.log(`📡 正在创建任务: ${taskId}`);
    await db.collection(COLLECTION_RESUMES).insertOne({
      openid: openid,
      task_id: taskId,
      status: 'processing',
      jobTitle: payload.job_data.title,
      jobTitle_cn: payload.job_data.title_chinese,
      jobTitle_en: payload.job_data.title_english,
      company: payload.job_data.team,
      jobId: payload.jobId,
      language: payload.language,
      createTime: new Date(),
      resumeInfo: payload.resume_profile,
      jobData: payload.job_data
    });

    // 3. 开启异步后台任务
    const services: TaskServices = { db };
    runBackgroundTask(taskId, payload, services);

    // 4. 立即返回 TaskID 给前端
    res.json({
      success: true,
      task_id: taskId,
      status: 'processing',
      message: '简历生成任务已启动，正在后台处理中'
    });

  } catch (error: any) {
    console.error('提交任务失败:', error);
    res.status(500).json({
      success: false,
      error: '任务提交失败',
      message: error.message,
    });
  }
});

export default router;
