import express, { Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

import { ResumeGenerator } from './resumeGenerator';
import { GeminiService } from './geminiService';
import { ResumeAIService } from './resumeAIService';
import { ResumeData, GenerateFromFrontendRequest, mapFrontendRequestToResumeData } from './types';
import { connectToLocalMongo, getDb } from './db';
import interfaceRouter from './interfaces';
import { ensureUser } from './userUtils';

const app = express();
const generator = new ResumeGenerator();
const gemini = new GeminiService();
const aiService = new ResumeAIService();

const COLLECTION_RESUMES = 'generated_resumes';
let db: any; 

// 解析 JSON 请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务 - 用于访问生成的简历
const PUBLIC_DIR = join(process.cwd(), 'public');
const RESUMES_DIR = join(PUBLIC_DIR, 'resumes');
if (!existsSync(RESUMES_DIR)) {
  mkdirSync(RESUMES_DIR, { recursive: true });
}
app.use('/public', express.static(PUBLIC_DIR));

// 注册所有接口路由
app.use(interfaceRouter);

/**
 * 异步后台任务：负责 AI 增强、PDF 生成和本地保存
 */
async function runBackgroundTask(taskId: string, payload: GenerateFromFrontendRequest) {
  if (!db) {
    console.error(`[Task ${taskId}] ❌ 无法启动后台任务：数据库未初始化`);
    return;
  }

  try {
    console.log(`[Task ${taskId}] 🤖 开始 AI 增强内容...`);
    // 1. 调用 AI 增强服务
    const resumeData = await aiService.enhance(payload);

    console.log(`[Task ${taskId}] 📄 开始生成 PDF...`);
    // 2. 生成 PDF Buffer
    const pdfBuffer = await generator.generatePDFToBuffer(resumeData);

    console.log(`[Task ${taskId}] 💾 开始保存到本地服务器...`);
    // 3. 保存到本地
    const timestamp = Date.now();
    const fileName = `${payload.userId}_${timestamp}_${taskId}.pdf`;
    const filePath = join(RESUMES_DIR, fileName);
    
    writeFileSync(filePath, pdfBuffer);
    const fileUrl = `/public/resumes/${fileName}`;

    // 4. 更新数据库状态为成功
    await db.collection(COLLECTION_RESUMES).updateOne({ task_id: taskId }, {
      $set: {
        status: 'completed',
        fileUrl: fileUrl, 
        completeTime: new Date()
      }
    });

    console.log(`[Task ${taskId}] ✅ 任务完成，保存路径: ${filePath}`);
  } catch (error: any) {
    console.error(`[Task ${taskId}] ❌ 任务处理失败:`, error);
    // 更新数据库状态为失败
    try {
      await db.collection(COLLECTION_RESUMES).updateOne({ task_id: taskId }, {
        $set: {
          status: 'failed',
          errorMessage: error.message || '内部处理超时或生成失败',
          completeTime: new Date()
        }
      });
    } catch (dbError) {
      console.error(`[Task ${taskId}] ❌ 无法更新失败状态到数据库:`, dbError);
    }
  }
}

// 配置 multer 用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req: express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // 只接受图片文件
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片文件'));
    }
  },
});

/**
 * 将文件 Buffer 转换为 Base64 Data URL
 */
function bufferToDataURL(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 生成简历 PDF API
 * POST /api/generate
 */
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

app.post('/api/generate', upload.single('avatar'), async (req: MulterRequest, res: Response) => {
  try {
    // [测试用] 打印接收到的数据
    console.log('🚀 收到生成请求');
    
    if (!req.body.resume_profile || !req.body.job_data) {
      return res.status(400).json({ error: '缺少必需的 resume_profile 或 job_data' });
    }

    const payload = req.body as GenerateFromFrontendRequest;
    const openid = req.headers['x-openid'] as string || payload.userId;

    if (!openid) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing OpenID' });
    }

    console.log('👤 用户姓名:', payload.resume_profile.name);
    console.log('💼 岗位名称:', payload.job_data.title_chinese || payload.job_data.title);

    if (!db) {
      return res.status(500).json({ error: '数据库未就绪' });
    }

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
        { openid: payload.userId },
        { $inc: { 'membership.pts_quota.used': 1 } }
      );
    } else if (topupBalance > 0) {
      // Use Top-up Quota
      consumedType = 'topup';
      await db.collection('users').updateOne(
        { openid: payload.userId },
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
    // 格式: RESUME_年月日时分秒_UUID前8位
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const taskId = `RESUME_${dateStr}_${randomUUID().slice(0, 8)}`;

    // 2. 预先入库（立即执行）
    console.log(`📡 正在创建任务: ${taskId}`);
    await db.collection(COLLECTION_RESUMES).insertOne({
      _openid: payload.userId,
      task_id: taskId,
      status: 'processing',
      jobTitle: payload.job_data.title_chinese || payload.job_data.title,
      company: payload.job_data.team,
      jobId: payload.jobId,
      createTime: new Date(),
      resumeInfo: payload.resume_profile // 保存快照
    });

    // 3. 开启异步后台任务
    runBackgroundTask(taskId, payload);

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
      error: '任务提交失败',
      message: error.message,
    });
  }
});

/**
 * 健康检查接口
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * 启动服务器
 */
const PORT = process.env.PORT || 3000;

async function startServer() {
  // 🚀 Step 0: 连接本地 MongoDB
  try {
    db = await connectToLocalMongo();
    console.log('✅ 使用本地 MongoDB 作为默认数据库');
  } catch (error) {
    console.warn('❌ 无法连接到数据库，服务器启动失败');
    process.exit(1);
  }

  // 🚀 启动服务器监听
  app.listen(PORT, () => {
    console.log(`简历生成服务已启动，端口: ${PORT}`);

    // 🚀 异步执行部署自检，不阻塞服务启动
    (async () => {
      console.log('🔍 正在异步执行自检: Gemini 连通性...');
      const geminiCheck = await gemini.checkConnectivity();
      
      if (geminiCheck.success) {
        console.log(`✅ ${geminiCheck.message}`);
      } else {
        console.error(`❌ ${geminiCheck.message}`);
        console.error('📋 排查信息:', JSON.stringify(geminiCheck.details, null, 2));
      }
    })();
  });
}

startServer();

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  await generator.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  await generator.close();
  process.exit(0);
});

export default app;
