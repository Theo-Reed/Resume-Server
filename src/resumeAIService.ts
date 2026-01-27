import { GeminiService } from "./geminiService";
import { GenerateFromFrontendRequest, ResumeData, mapFrontendRequestToResumeData } from "./types";
import { generateChinesePrompt } from "./prompts/ChinesePrompt";
import { generateEnglishPrompt } from "./prompts/EnglishPrompt";
import { ExperienceCalculator } from "./utils/experienceCalculator";

export class ResumeAIService {
  private gemini: GeminiService;

  constructor() {
    this.gemini = new GeminiService();
  }

  /**
   * 核心方法：利用 AI 增强简历内容
   */
  async enhance(payload: GenerateFromFrontendRequest): Promise<ResumeData> {
    const baseData = mapFrontendRequestToResumeData(payload);
    const { resume_profile: profile, job_data: job, language } = payload;
    const isEnglish = language === 'english';

    // 辅助函数：校验字段是否合法（非空且非 AI 占位符）
    const isIllegal = (val: any) => {
      if (val === undefined || val === null) return true;
      const s = String(val).trim().toLowerCase();
      
      // 1. 过滤极其短或明显的空值
      if (s === "" || s === "undefined" || s === "null" || s === "nan" || s === "暂无" || s === "none") return true;
      
      // 2. 检测 AI 常见的乱码和占位符
      // 不合法的 Unicode 替换字符 (\uFFFD)
      if (s.includes("\uFFFD")) return true;
      
      // 检测占位符（如 _PLACEHOLDER_BOLD_1_）
      if (s.includes("_placeholder_") || s.includes("placeholder_bold")) return true;
      
      // 3. 常见的 AI 表达痕迹 / 幻觉占位符
      // 匹配 [公司名称] [职位] [xx时间] 等
      const hasBrackets = /\[(.*?名字|.*?公司|.*?时间|.*?名称|.*?经验|.*?Name|.*?Company|.*?Time|.*?Project)\]/i.test(s);
      if (hasBrackets) return true;

      // 4. 禁止 AI 在字段内进行自我介绍或道歉
      const aiMarkers = ["as an ai", "large language model", "sorry", "cannot fulfill", "对不起", "抱歉", "无法生成"];
      if (aiMarkers.some(marker => s.includes(marker))) return true;

      return false;
    };

    // 直接取值，清洗逻辑完全交给 Prompt 处理
    const targetTitle = isEnglish 
      ? (job.title_english || job.title_chinese) 
      : job.title_chinese;

    // 2. Delegate Logic to ExperienceCalculator
    const calcResult = ExperienceCalculator.calculate(profile, job);
    
    // Destructure for Prompt Construction
    const { 
        actualYears, 
        actualExperienceText,
        totalMonths,
        requiredExp,
        needsSupplement,
        supplementYears,
        finalTotalYears,
        supplementSegments,
        allWorkExperiences,
        earliestWorkDate,
        seniorityThresholdDate
    } = calcResult;
    // 4. 构造 Prompt
    const promptContext = {
      targetTitle,
      job,
      requiredExp,
      profile,
      earliestWorkDate,
      actualExperienceText,
      totalMonths: calcResult.totalMonths, // Ensure prompt uses what came back
      needsSupplement,
      actualYears,
      supplementYears,
      finalTotalYears,
      supplementSegments,
      allWorkExperiences,
      seniorityThresholdDate
    };

    const prompt = isEnglish 
      ? generateEnglishPrompt(promptContext)
      : generateChinesePrompt(promptContext);


    try {
      const aiResponse = await this.gemini.generateContent(prompt, (text) => {
        // 1. 全局非法内容扫描 (Gemini 常见异常输出)
        const lowerText = text.toLowerCase();
        const illegalPatterns = [
          "_placeholder_",
          "placeholder_bold",
          "_PLACEHOLDER_BOLD_",
          "as an ai language model",
          "cannot fulfill",
          "my programming",
          "对不起，我无法",
          "抱歉，我不能",
          "---", // 异常的分割线，通常代表输出不完整或被切断
          "...",  // 异常的省略，同上
        ];

        if (illegalPatterns.some(p => text.includes(p) || lowerText.includes(p))) {
          throw new Error("检测到 AI 输出包含非法占位符或拒绝性话术");
        }

        // 检测 Unicode 乱码字符 (\uFFFD)
        if (text.includes("\uFFFD")) {
          throw new Error("检测到 AI 输出包含 Unicode 替换字符 (\uFFFD)");
        }

        try {
          const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const data = JSON.parse(jsonStr);
          
          // 2. 严格验证字段，如果缺失或包含非法内容，返回 false 触发重试/切模型
          const requiredFields = ['position', 'yearsOfExperience', 'personalIntroduction', 'professionalSkills', 'workExperience'];
          for (const field of requiredFields) {
            if (isIllegal(data[field])) {
              throw new Error(`关键字段 "${field}" 内容非法或缺失`);
            }
          }
          return true;
        } catch (e: any) {
          throw new Error(`JSON 逻辑校验未通过: ${e.message}`);
        }
      });

      // 如果能执行到这里，说明已经通过了上面的 validator 校验
      const jsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const enhancedData = JSON.parse(jsonStr);

      // 3. 校验视觉内容密度 (仅针对中文简历进行行填充校验)
      if (!isEnglish && enhancedData.workExperience) {
        const CPL = 48; // 每行中文字符容量 (基于14px字体和680px可用宽度所得出的约数)
        enhancedData.workExperience.forEach((exp: any, expIdx: number) => {
          if (exp.responsibilities && Array.isArray(exp.responsibilities)) {
            exp.responsibilities.forEach((item: string, itemIdx: number) => {
              // 计算视觉长度：中文字符计1，英数/标点计0.5
              const visualLength = item.split('').reduce((acc, char) => {
                return acc + (/[^\x00-\xff]/.test(char) ? 1 : 0.5);
              }, 0);
              
              const remainder = visualLength % CPL;
              // 如果余数为0且总长度大于0，则视为 100% 填充
              const percent = (remainder === 0 && visualLength > 0) ? 1 : remainder / CPL;
              
              // 校验规则：最后一行必须填充单行宽度的 30% 以上 (原50%过于严格，调整为30%以配合新布局算法)
              if (percent < 0.3) {
                const shortText = item.length > 15 ? item.substring(0, 15) + '...' : item;
                // Soft warning in logs instead of throwing, let User adjust or iterate?
                // For now, strict mode is safer for quality.
                throw new Error(`[排版校验失败] 工作经历 ${expIdx + 1} 的第 ${itemIdx + 1} 条职责文字数量不够 ("${shortText}")，导致右侧留白过大 (填充率: ${Math.round(percent * 100)}%)`);
              }
            });
          }
        });
      }

      // 合并数据
      return {
        ...baseData,
        // 使用 AI 生成的专业职级名称，而不是原始的 Target Title
        // 因为 Target Title 可能包含冗余后缀（如" - 生态系统专家"），而 AI 会根据指令生成标准职称
        position: enhancedData.position || targetTitle, 
        yearsOfExperience: Math.floor(enhancedData.yearsOfExperience || baseData.yearsOfExperience || 0),
        personalIntroduction: enhancedData.personalIntroduction,
        professionalSkills: enhancedData.professionalSkills,
        workExperience: enhancedData.workExperience,
      };
    } catch (error: any) {
      // 这里的错误会向上抛给 runBackgroundTask，从而触发数据库状态更新为 failed
      console.error("AI 增强流程异常:", error.message);
      throw error;
    }
  }
}
