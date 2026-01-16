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
      // 过滤常见的 AI 逃避性占位符
      return s === "" || s === "undefined" || s === "null" || s === "nan" || s === "暂无" || s === "none";
    };

    // 直接取值，不再做复杂判断，因为你确认它不为空
    const targetTitle = isEnglish ? (job.title_english || job.title_chinese) : job.title_chinese;

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
        earliestWorkDate
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
      allWorkExperiences
    };

    const prompt = isEnglish 
      ? generateEnglishPrompt(promptContext)
      : generateChinesePrompt(promptContext);


    try {
      const aiResponse = await this.gemini.generateContent(prompt, (text) => {
        try {
          const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const data = JSON.parse(jsonStr);
          
          // 严格验证字段，如果缺失或包含非法内容，返回 false 触发重试/切模型
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
