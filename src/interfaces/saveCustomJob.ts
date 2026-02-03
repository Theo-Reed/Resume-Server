import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

/**
 * 保存用户手动输入的岗位信息（用于文字生成简历）
 * POST /api/saveCustomJob
 */
router.post('/saveCustomJob', async (req: Request, res: Response) => {
  try {
    const { title, content, experience } = req.body;
    const openid = req.headers['x-openid'] as string;

    if (!openid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!title || !content) {
      return res.status(400).json({ success: false, message: '岗位标题和内容不能为空' });
    }

    const db = getDb();
    const collection = db.collection('custom_jobs');

    const newJob = {
      openid: openid,
      title: title,
      title_chinese: title,
      description_chinese: content,
      experience: experience || '经验不限',
      team: '手动录入',
      source_name: '文字生成',
      createTime: new Date()
    };

    const result = await collection.insertOne(newJob);

    res.json({
      success: true,
      result: {
        jobId: result.insertedId,
        jobData: {
          ...newJob,
          _id: result.insertedId
        }
      }
    });

  } catch (error) {
    console.error('saveCustomJob error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

export default router;
