import { Router, Request, Response } from 'express';
import { getDb } from '../../db';

const router = Router();

// Used in: components/job-tab/index.ts
router.post('/getPublicJobList', async (req: Request, res: Response) => {
  try {
    const { pageSize = 10, skip = 0, source_name, salary, experience, type, language } = req.body;
    const db = getDb();
    
    // 构建查询条件
    const query: any = { is_deleted: { $ne: true } };
    
    // 地区筛选 - 默认为国内
    if (type && type !== '全部') {
      query.type = type;
    } else {
      query.type = '国内';
    }

    // 来源筛选
    if (source_name && Array.isArray(source_name) && source_name.length > 0) {
      query.source_name = { $in: source_name };
    }

    // 薪资和经验筛选
    if (salary && salary !== '全部') {
      query.salary = { $regex: salary, $options: 'i' };
    }
    if (experience && experience !== '全部') {
      query.experience = { $regex: experience, $options: 'i' };
    }

    const jobs = await db.collection('remote_jobs')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    res.json({
      success: true,
      data: {
        ok: true,
        jobs: jobs
      }
    });
  } catch (error) {
    console.error('getPublicJobList error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
