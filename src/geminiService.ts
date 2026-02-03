import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Gemini 服务类
 */
export class GeminiService {
  private apiKey: string;
  private baseUrl: string = "https://gemini.yeatom.online";

  constructor() {
    this.apiKey = process.env.GEMINI_API || "";

    if (!this.apiKey) {
      console.warn("⚠️ 未检测到 GEMINI_API 环境变量，通过 .env 文件或系统变量进行配置");
    }
  }

  /**
   * 极简连通性测试：不浪费配额，提供详细错误排查
   */
  async checkConnectivity(): Promise<{ success: boolean; message: string; details?: any }> {
    if (!this.apiKey) {
      return { success: false, message: "环境变量 GEMINI_API 为空" };
    }

    try {
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel(
        { model: "gemini-2.0-flash" },
        { baseUrl: this.baseUrl }
      );

      // 使用极简请求，几乎不消耗 token
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: "p" }] }],
        generationConfig: { maxOutputTokens: 1 }
      });

      await result.response;
      return { success: true, message: "Gemini 连通性测试通过" };
    } catch (error: any) {
      let errorMsg = error.message || "未知错误";

      // 常见错误排查指南
      if (errorMsg.includes("403")) errorMsg += " (可能是 API Key 无效或未启用 Gemini API)";
      if (errorMsg.includes("404")) errorMsg += " (可能是域名/模型路径错误)";
      if (errorMsg.includes("fetch failed")) errorMsg += " (网络不可达，请检查域名解析或代理设置)";

      return {
        success: false,
        message: "Gemini 连通性测试失败",
        details: {
          error: errorMsg,
          baseUrl: this.baseUrl,
          apiKeyPrefix: this.apiKey.substring(0, 5) + "...",
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * 核心调用方法：带重试机制和结果校验
   * @param prompt 提示词
   * @param validator 可选的校验函数
   */
  async generateContent(prompt: string, validator?: (text: string) => boolean | Promise<boolean>): Promise<string> {
    const models = [
      "gemini-3-flash-preview",
      "gemini-3-pro-preview",
      "gemini-2.5-pro",
    ];

    const attempts = 3;
    
    for (let attempt = 1; attempt <= attempts; attempt++) {
      console.log(`\n🤖 [Attempt ${attempt}/${attempts}] 正在尝试调用 AI...`);

      for (const modelName of models) {
        try {
          console.log(`   - 尝试使用模型: ${modelName}`);
          const genAI = new GoogleGenerativeAI(this.apiKey);
          const model = genAI.getGenerativeModel(
            { model: modelName },
            { baseUrl: this.baseUrl }
          );

          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();

          // 执行逻辑校验
          if (validator) {
            try {
              const isValid = await validator(text);
              if (!isValid) throw new Error("模型输出未通过逻辑校验");
            } catch (valError: any) {
              console.warn(`      ⚠️ ${modelName} 输出校验失败: ${valError.message}`);
              throw valError; 
            }
          }

          console.log(`   ✅ ${modelName} 调用成功`);
          return text;
        } catch (error: any) {
          console.error(`      ❌ ${modelName} 失败:`, error.message);
          // 继续尝试下一个模型
        }
      }

      // 如果所有模型都试过了但还是失败了
      if (attempt < attempts) {
        // 计算等待时间 (10-30s 或 20-40s)
        const minWait = attempt === 1 ? 10 : 20;
        const maxWait = attempt === 1 ? 30 : 40;
        const waitSec = Math.floor(Math.random() * (maxWait - minWait + 1)) + minWait;
        
        console.log(`\n⚠️ 所有模型在 Attempt ${attempt} 中均失败。系统将在 ${waitSec} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
      } else {
        throw new Error(`经过 ${attempts} 次重试且尝试了所有候选模型后，AI 仍无法提供有效回复。请稍后再试。`);
      }
    }

    return "";
  }
}

/**
 * 测试脚本
 */
async function testGemini() {
  const service = new GeminiService();
  const testPrompt = "你好，请简单介绍一下你自己。";

  try {
    console.log("🚀 开始测试 Gemini 调用...");
    const response = await service.generateContent(testPrompt);
    console.log("📝 Gemini 回复内容:");
    console.log(response);
  } catch (error) {
    console.error("💥 测试过程中出现严重错误:", error);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  testGemini();
}

