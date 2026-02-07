import { GeminiService } from "./geminiService";
import { GenerateFromFrontendRequest, ResumeData, mapFrontendRequestToResumeData } from "./types";
import { generateChinesePrompt } from "./prompts/ChinesePrompt";
import { generateEnglishPrompt } from "./prompts/EnglishPrompt";
import { ExperienceCalculator } from "./utils/experienceCalculator";
import pdf from 'pdf-parse';

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

    // 辅助函数：校验字段是否合法（支持递归检查）
    const isIllegal = (val: any): boolean => {
      if (val === undefined || val === null) return true;

      // 1. 如果是数组，递归检查每一项
      if (Array.isArray(val)) {
        return val.length === 0 || val.some(item => isIllegal(item));
      }

      // 2. 如果是对象，递归检查所有属性值
      if (typeof val === 'object') {
        return Object.values(val).some(v => isIllegal(v));
      }

      const s = String(val).trim().toLowerCase();
      
      // 1. 过滤极其短或明显的空值
      if (s === "" || s === "undefined" || s === "null" || s === "nan" || s === "暂无" || s === "none") return true;
      
      // 2. 检测 AI 常见的乱码和占位符
      if (s.includes("\uFFFD")) return true;
      if (s.includes("_placeholder_") || s.includes("placeholder_bold")) return true;
      
      // 3. 常见的 AI 表达痕迹 / 幻觉占位符
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
    
    // 3. 准备排版元数据
    // 根据 594px 净文本宽度 (694-40-40-20) 和 14px 字号计算
    // 594 / 14 = 42.42, 取 42 较为精准
    const maxCharPerLine = isEnglish ? 90 : 42; 
    
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
      seniorityThresholdDate,
      maxCharPerLine
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
          "---", 
          "...",  
        ];

        if (illegalPatterns.some(p => text.includes(p) || lowerText.includes(p))) {
          throw new Error("检测到 AI 输出包含非法占位符或拒绝性话术");
        }

        if (text.includes("\uFFFD")) {
          throw new Error("检测到 AI 输出包含 Unicode 替换字符 (\uFFFD)");
        }

        try {
          const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const data = JSON.parse(jsonStr);
          
          // 2. 严格验证字段
          const requiredFields = ['position', 'yearsOfExperience', 'personalIntroduction', 'professionalSkills', 'workExperience'];
          for (const field of requiredFields) {
            if (isIllegal(data[field])) {
              throw new Error(`关键字段 "${field}" 内容非法、缺失或包含无效嵌套内容`);
            }
          }

          // 3. 数量强制校验 (仅限中文，确保素材充足以供裁剪)
          if (!isEnglish) {
            // 校验工作经历职责数量 (必须为 8)
            const hasWrongResponsibilityCount = data.workExperience.some((exp: any) => 
               !exp.responsibilities || exp.responsibilities.length !== 8
            );
            if (hasWrongResponsibilityCount) {
              throw new Error("AI 生成的工作职责数量不足 8 条，触发重试");
            }

            // 校验技能分类数量 (必须为 4)
            if (data.professionalSkills.length !== 4) {
              throw new Error("AI 生成的技能分类数量不足 4 组，触发重试");
            }

            // 校验每个技能分类下的点数 (必须为 4)
            const hasWrongSkillItemCount = data.professionalSkills.some((cat: any) => 
              !cat.items || cat.items.length !== 4
            );
            if (hasWrongSkillItemCount) {
              throw new Error("AI 生成的技能点数量不足 4 条/组，触发重试");
            }
          }

          return true;
        } catch (e: any) {
          throw new Error(`逻辑校验未通过: ${e.message}`);
        }
      });

      // 如果能执行到这里，说明已经通过了上面的 validator 校验
      const jsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const enhancedData = JSON.parse(jsonStr);

      // 3. 记录视觉内容密度 (仅记录日志，不再抛出异常，由本地代码执行裁剪)
      if (!isEnglish && enhancedData.workExperience) {
        const CPL = maxCharPerLine; 
        enhancedData.workExperience.forEach((exp: any, expIdx: number) => {
          if (exp.responsibilities && Array.isArray(exp.responsibilities)) {
            exp.responsibilities.forEach((item: string, itemIdx: number) => {
              const visualLength = item.split('').reduce((acc, char) => {
                return acc + (/[^\x00-\xff]/.test(char) ? 1 : 0.5);
              }, 0);
              
              const remainder = visualLength % CPL;
              const percent = (remainder === 0 && visualLength > 0) ? 1 : remainder / CPL;
              
              if (percent < 0.3) {
                console.warn(`[排版建议] 工作经历 ${expIdx + 1} 的第 ${itemIdx + 1} 条职责可能留白过大 (填充率: ${Math.round(percent * 100)}%)`);
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

  /**
   * 从文档（PDF/Image）中提取简历信息
   */
  async extractResumeInfoFromDocument(fileBuffer: Buffer, mimeType: string): Promise<any> {
    let text = "";
    let parts: any[] = [];

    if (mimeType === 'application/pdf') {
       try {
         const data = await pdf(fileBuffer);
         text = data.text;
       } catch (e) {
         console.error("PDF Parsing failed", e);
         throw new Error("PDF解析失败");
       }
    } else if (mimeType.startsWith('image/')) {
        parts.push({
            inlineData: {
                mimeType,
                data: fileBuffer.toString('base64')
            }
        });
    } else {
        throw new Error("不支持的文件类型: " + mimeType);
    }

    const prompt = `
    You are an expert Resume Parser. 
    Analyze the provided resume document (text or image) and extract the candidate's profile information into a strictly valid JSON object.
    
    The JSON structure must be:
    {
      "name": "Candidate Name",
      "mobile": "Phone Number",
      "email": "Email Address",
      "city": "Current City",
      "education": [
        { "school": "School Name", "degree": "Degree", "major": "Major", "startTime": "YYYY-MM", "endTime": "YYYY-MM" }
      ],
      "experience": [
        { "company": "Company Name", "role": "Job Title", "startTime": "YYYY-MM", "endTime": "YYYY-MM", "description": "Summary of responsibilities" }
      ],
      "projects": [
        { "name": "Project Name", "role": "Role", "startTime": "YYYY-MM", "endTime": "YYYY-MM", "description": "Details" }
      ],
      "skills": ["Skill 1", "Skill 2"]
    }
    
    If specific fields are missing, leave them as empty strings or empty arrays. 
    Dates should be normalized to YYYY-MM format. 'Present' should be the current date (2026-02).
    Only return the JSON. No markdown formatting.
    ${text ? `\nResume Content:\n${text}` : ""}
    `;

    try {
        let result = "";
        if (text) {
            // Text-only mode
            result = await this.gemini.generateContent(prompt);
        } else {
            // Vision mode
            parts.push({ text: prompt });
            result = await this.gemini.generateContentWithParts(parts);
        }
        return this.parseJSON(result);
    } catch (e: any) {
        console.error("Gemini Extraction Failed", e);
        throw new Error("AI 解析简历失败: " + e.message);
    }
  }

  private parseJSON(text: string): any {
      try {
          // Remove Markdown Code Blocks if present
          const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
              return JSON.parse(jsonMatch[0]);
          }
          return JSON.parse(cleanText);
      } catch (e) {
          console.error("Failed to parse AI JSON response", text);
          throw new Error("简历解析失败，AI返回格式错误");
      }
  }
}
