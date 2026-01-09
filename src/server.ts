import express, { Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { randomUUID } from 'crypto';
const tcb = require("@cloudbase/node-sdk");
import { ResumeGenerator } from './resumeGenerator';
import { GeminiService } from './geminiService';
import { ResumeAIService } from './resumeAIService';
import { ResumeData, GenerateFromFrontendRequest, mapFrontendRequestToResumeData } from './types';

const app = express();
const generator = new ResumeGenerator();
const gemini = new GeminiService();
const aiService = new ResumeAIService();

const COLLECTION_RESUMES = 'generated_resumes';

// 1. 确定最终要连接的环境 ID (用于部署自检)
const FINAL_ENV_ID = process.env.CLOUD_ENV;
let tcbApp: any;

if (FINAL_ENV_ID) {
  tcbApp = tcb.init({
    env: FINAL_ENV_ID,
    secretId: process.env.SecretId,
    secretKey: process.env.SecretKey,
  });
}

// 在 @cloudbase/node-sdk 中，数据库通过 app.database() 获取
// 但存储操作（如 uploadFile）直接在 tcbApp 实例上调用
const db = tcbApp ? tcbApp.database() : null;

/**
 * 异步后台任务：负责 AI 增强、PDF 生成和上传云存储
 */
async function runBackgroundTask(taskId: string, payload: GenerateFromFrontendRequest) {
  if (!tcbApp || !db) {
    console.error(`[Task ${taskId}] ❌ 无法启动后台任务：TCB App 或数据库未初始化`);
    return;
  }

  try {
    console.log(`[Task ${taskId}] 🤖 开始 AI 增强内容...`);
    // 1. 调用 AI 增强服务
    const resumeData = await aiService.enhance(payload);

    console.log(`[Task ${taskId}] 📄 开始生成 PDF...`);
    // 2. 生成 PDF Buffer
    const pdfBuffer = await generator.generatePDFToBuffer(resumeData);

    console.log(`[Task ${taskId}] ☁️ 开始上传到云存储 (使用 tcbApp.uploadFile)...`);
    // 3. 上传到云存储
    // 路径规则：resumes/用户OpenID/时间戳_taskId.pdf
    const timestamp = Date.now();
    const cloudPath = `resumes/${payload.userId}/${timestamp}_${taskId}.pdf`;
    
    // 注意：@cloudbase/node-sdk 的 uploadFile 是直接在 app 实例上的，没有 .storage() 方法
    const uploadRes = await tcbApp.uploadFile({
      cloudPath: cloudPath,
      fileContent: pdfBuffer
    });

    // 4. 更新数据库状态为成功
    await db.collection(COLLECTION_RESUMES).where({ task_id: taskId }).update({
      status: 'completed',
      fileId: uploadRes.fileID,
      completeTime: db.serverDate() // 补充完成时间
    });

    console.log(`[Task ${taskId}] ✅ 任务完成并已上传: ${uploadRes.fileID}`);
  } catch (error: any) {
    console.error(`[Task ${taskId}] ❌ 任务处理失败:`, error);
    // 更新数据库状态为失败
    try {
      await db.collection(COLLECTION_RESUMES).where({ task_id: taskId }).update({
        status: 'failed',
        errorMessage: error.message || '内部处理超时或生成失败',
        completeTime: db.serverDate()
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

// 解析 JSON 请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
    console.log('👤 用户姓名:', payload.resume_profile.name);
    console.log('💼 岗位名称:', payload.job_data.title_chinese || payload.job_data.title);

    if (!db || !tcbApp) {
      return res.status(500).json({ error: '数据库或 TCB 服务未就绪，请检查 CLOUD_ENV 配置' });
    }

    // 1. 生成唯一 Task ID
    // 格式: RESUME_年月日时分秒_UUID前8位
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const taskId = `RESUME_${dateStr}_${randomUUID().slice(0, 8)}`;

    // 2. 预先入库（立即执行）
    console.log(`📡 正在创建任务: ${taskId}`);
    await db.collection(COLLECTION_RESUMES).add({
      _openid: payload.userId,
      task_id: taskId,
      status: 'processing',
      jobTitle: payload.job_data.title_chinese || payload.job_data.title,
      company: payload.job_data.team,
      jobId: payload.jobId,
      createTime: db.serverDate(),
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
// ⚠️ 微信云托管强制要求监听 80 端口
const PORT = process.env.PORT || 80;

async function startServer() {
  // 🚀 部署自检 1：测试 Gemini 连通性
  console.log('🔍 正在执行部署自检: Gemini 连通性...');
  const geminiCheck = await gemini.checkConnectivity();
  
  if (geminiCheck.success) {
    console.log(`✅ ${geminiCheck.message}`);
  } else {
    console.error(`❌ ${geminiCheck.message}`);
    console.error('📋 排查信息:', JSON.stringify(geminiCheck.details, null, 2));
  }

  // 🚀 部署自检 2：测试 CLOUD_ENV 数据库连通性
  if (tcbApp) {
    console.log(`🔍 正在执行部署自检: 数据库连通性 (${FINAL_ENV_ID})...`);
    try {
      const dbInstance = tcbApp.database();
      await dbInstance.collection('users').limit(1).get();
      console.log('✅ 数据库连通性测试通过');
    } catch (error: any) {
      console.error('❌ 数据库连通性测试失败');
      console.error('   错误信息:', error.message || error);
    }
  } else {
    console.log('ℹ️ 未检测到 CLOUD_ENV 或 TCB 配置，跳过数据库连通性自检');
  }

app.listen(PORT, () => {
  console.log(`简历生成服务已启动，端口: ${PORT}`);
  console.log(`API 端点: http://localhost:${PORT}/api/generate`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
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
