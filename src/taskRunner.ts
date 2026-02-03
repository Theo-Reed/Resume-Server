import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import pLimit from 'p-limit';
import { GenerateFromFrontendRequest } from './types';
import { ResumeAIService } from './resumeAIService';
import { ResumeGenerator } from './resumeGenerator';

// 创建并发限制器：限制同时进行的生成任务数量为 2
const limit = pLimit(2);

// 定义依赖接口
export interface TaskServices {
  db: any;
  // 以下服务在由于“以测试为基准”的逻辑下，将在任务内部按需创建
}

const COLLECTION_RESUMES = 'generated_resumes';

// 静态文件服务 - 用于访问生成的简历
const PUBLIC_DIR = join(process.cwd(), 'public');
const RESUMES_DIR = join(PUBLIC_DIR, 'resumes');
if (!existsSync(RESUMES_DIR)) {
  mkdirSync(RESUMES_DIR, { recursive: true });
}

/**
 * 包装器：确保任务受并发限制器控制
 */
export async function runBackgroundTask(taskId: string, payload: GenerateFromFrontendRequest, services: TaskServices) {
  return limit(() => executeTask(taskId, payload, services));
}

/**
 * 实际的后台任务执行逻辑：负责 AI 增强、PDF 生成和本地保存
 * 基准参考: tests/full_flow_test.ts
 */
async function executeTask(taskId: string, payload: GenerateFromFrontendRequest, services: TaskServices) {
  const { db } = services;
  console.log(`\n🚀 [Task ${taskId}] 后台任务启动 (并发通道已占用)...`);

  if (!db) {
    console.error(`[Task ${taskId}] ❌ 无法启动后台任务：数据库未初始化`);
    return;
  }

  // 1. 准备本地服务实例 (以 tests/full_flow_test.ts 为基准，每次任务使用独立实例)
  const aiService = new ResumeAIService();
  const generator = new ResumeGenerator();

  try {
    // Stage 1: AI 增强
    console.log(`\n🤖 [Task ${taskId}] [Step 1/2] 正在调用 AI 进行内容增强...`);
    const enhancedData = await aiService.enhance(payload);
    
    console.log(`✅ [Task ${taskId}] AI 增强完成！素材概览:`);
    console.log(`- 岗位: ${enhancedData.position}`);
    console.log(`- 个人介绍长度: ${enhancedData.personalIntroduction.length} 字`);
    console.log(`- 技能组数量: ${enhancedData.professionalSkills?.length || 0}`);
    console.log(`- 工作经历数: ${enhancedData.workExperience.length}`);
    enhancedData.workExperience.forEach((exp, i) => {
        console.log(`  [Job ${i+1}] ${exp.company} (${exp.startDate}-${exp.endDate}) - 职责数: ${exp.responsibilities?.length || 0}`);
    });

    // Stage 2: PDF 生成
    console.log(`\n📄 [Task ${taskId}] [Step 2/2] 正在启动布局引擎进行模拟与裁剪...`);
    await generator.init();
    
    const timestamp = Date.now();
    const fileName = `${payload.openid}_${timestamp}_${taskId}.pdf`;
    const filePath = join(RESUMES_DIR, fileName);
    const fileUrl = `/public/resumes/${fileName}`;

    // 直接生成到文件 (遵循测试基准逻辑)
    await generator.generatePDFToFile(enhancedData, filePath);

    // 4. 更新数据库状态为成功
    await db.collection(COLLECTION_RESUMES).updateOne({ task_id: taskId }, {
      $set: {
        status: 'completed',
        fileUrl: fileUrl, 
        completeTime: new Date()
      }
    });

    console.log(`\n🎉 [Task ${taskId}] 任务圆满完成！`);
    console.log(`✅ 简历已生成并保存至: ${filePath}`);
    
    // 释放资源
    await generator.close();
  } catch (error: any) {
    console.error(`\n❌ [Task ${taskId}] 任务处理流程异常:`, error.message);
    if (error.stack) console.error(error.stack);

    // 确保资源被释放
    try { await generator.close(); } catch (e) {}

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

