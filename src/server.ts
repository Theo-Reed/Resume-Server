import express, { Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import { runBackgroundTask, TaskServices } from './taskRunner';

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

// Share services globally
app.locals.services = {
    generator,
    gemini,
    aiService
};

// 解析 JSON 请求体
app.use(express.json({ 
    limit: '10mb',
    verify: (req: any, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global Logging Middleware
app.use((req, res, next) => {
  // 启用 Cross-Origin Isolation（用于允许 SharedArrayBuffer 等特性）
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// 静态文件服务 - 用于访问生成的简历
const PUBLIC_DIR = join(process.cwd(), 'public');
const RESUMES_DIR = join(PUBLIC_DIR, 'resumes');
if (!existsSync(RESUMES_DIR)) {
  mkdirSync(RESUMES_DIR, { recursive: true });
}
app.use('/public', express.static(PUBLIC_DIR));

// 注册所有接口路由
app.use(interfaceRouter);

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
 * 健康检查接口
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * 启动服务器
 */
const PORT = process.env.PORT || 3000;

/**
 * 自动清理一天以前的物理文件，但保留数据库元数据
 */
function cleanupExpiredPdfs() {
  try {
    const files = readdirSync(RESUMES_DIR);
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    let count = 0;

    files.forEach(file => {
      if (!file.endsWith('.pdf')) return;
      const filePath = join(RESUMES_DIR, file);
      const stats = statSync(filePath);
      if (now - stats.mtimeMs > ONE_DAY_MS) {
        unlinkSync(filePath);
        count++;
      }
    });
    if (count > 0) {
      console.log(`🧹 已自动清理 ${count} 个超过 24 小时的旧 PDF 文件（本地存储已释放）`);
    }
  } catch (err) {
    console.error('❌ 清理过期 PDF 失败:', err);
  }
}

async function startServer() {
  // 🚀 Step 0: 环境检查
  generator.checkEnvironment();

  // 🚀 Step 1: 连接本地 MongoDB
  try {
    db = await connectToLocalMongo();
    console.log('✅ 使用本地 MongoDB 作为默认数据库');

    // 🚀 Step 2: 建立必要索引（即使已存在也会跳过，保证查询效率）
    const usersColl = db.collection('users');
    // 使用 try-catch 避免因为索引冲突导致服务器无法启动，并改为与 init_db.js 一致的多元化索引
    try {
      await usersColl.createIndex({ openids: 1 }, { unique: true, sparse: true });
      await usersColl.createIndex({ phone: 1 }, { unique: true, sparse: true });
      await usersColl.createIndex({ openid: 1 }); // 兼容旧系统的 openid 字段
    } catch (e) {
      console.warn('⚠️ 用户索引设置可能存在冲突，但不影响启动:', e);
    }
    
    const resumesColl = db.collection('generated_resumes');
    await resumesColl.createIndex({ openid: 1 });
    await resumesColl.createIndex({ task_id: 1 });
    await resumesColl.createIndex({ jobId: 1 });

    // 🚀 Step 3: 启动时清理僵死任务
    // 如果服务器异常重启，之前的 processing 任务将永远卡住，需统一重置
    await resumesColl.updateMany(
      { status: 'processing' },
      { $set: { status: 'failed', error: 'Server Reboot Cleaned' } }
    );
    console.log('🧹 启动前任务清理完成');

    // 🚀 Step 4: 清理过期物理文件
    cleanupExpiredPdfs();
    // 每小时运行一次清理
    setInterval(cleanupExpiredPdfs, 60 * 60 * 1000);

  } catch (error) {
    console.warn('❌ 无法连接到数据库，服务器启动失败');
    process.exit(1);
  }

  // 🚀 启动服务器监听
  app.listen(PORT, () => {
    console.log(`简历生成服务已启动，端口: ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('严重错误: 服务器启动失败');
  console.error(err);
  process.exit(1);
});

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
