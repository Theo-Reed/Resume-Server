import { GeminiService } from "./geminiService";
import { GenerateFromFrontendRequest, ResumeData, mapFrontendRequestToResumeData } from "./types";
import { generateChineseJobBulletPrompt, generateChineseNonJobPrompt } from "./prompts/ChinesePrompt";
import { generateEnglishJobBulletPrompt, generateEnglishNonJobPrompt } from "./prompts/EnglishPrompt";
import { generateExtractionPrompt } from "./prompts/ExtractionPrompt";
import { ExperienceCalculator } from "./utils/experienceCalculator";
import { BulletPhaseWorkExperience } from "./prompts/types";
const pdf = require('pdf-parse');

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

    const buildExpKey = (company: string, startDate: string, endDate: string): string =>
      `${(company || '').trim()}|${(startDate || '').trim()}|${(endDate || '').trim()}`;

    const normalizeTitleForCompare = (title: string): string =>
      (title || '')
        .toLowerCase()
        .replace(/[\s\-_/.,，。()（）\[\]【】]/g, '')
        .trim();

    const detectRoleTracks = (title: string): Set<string> => {
      const normalized = (title || '').toLowerCase();
      const tracks = new Set<string>();

      const rules: Array<{ track: string; pattern: RegExp }> = [
        { track: 'backend', pattern: /后端|后台|backend|server|java|golang|go\b|python|php|\.net|c#|node|api|微服务|分布式/ },
        { track: 'frontend', pattern: /前端|frontend|react|vue|angular|javascript|typescript|h5|小程序/ },
        { track: 'mobile', pattern: /android|ios|移动端|客户端|flutter|react native|rn\b|鸿蒙/ },
        { track: 'data', pattern: /数据|data|bi\b|etl|数仓|算法|analyst|algorithm|machine learning|ml\b|ai\b/ },
        { track: 'product', pattern: /产品|product manager|product owner|pm\b/ },
        { track: 'design', pattern: /设计|designer|ui\b|ux\b/ },
        { track: 'operation', pattern: /运营|operation|ops\b|增长|growth|新媒体/ },
        { track: 'marketing', pattern: /市场|marketing|投放|广告|品牌/ },
        { track: 'sales', pattern: /销售|商务|bd\b|business development|account manager|客户经理/ },
        { track: 'hr', pattern: /人事|hr\b|recruit|招聘/ },
        { track: 'finance', pattern: /财务|会计|finance|accounting|审计|税务/ },
        { track: 'legal', pattern: /法务|legal|compliance|合规|风控/ },
      ];

      rules.forEach(({ track, pattern }) => {
        if (pattern.test(normalized)) tracks.add(track);
      });

      return tracks;
    };

    const isFunctionallyCloseTitle = (originalTitle: string, target: string): boolean => {
      const originalNorm = normalizeTitleForCompare(originalTitle);
      const targetNorm = normalizeTitleForCompare(target);
      if (!originalNorm || !targetNorm) return false;
      if (originalNorm === targetNorm || originalNorm.includes(targetNorm) || targetNorm.includes(originalNorm)) {
        return true;
      }

      const originalTracks = detectRoleTracks(originalTitle);
      const targetTracks = detectRoleTracks(target);
      if (originalTracks.size === 0 || targetTracks.size === 0) return false;

      for (const track of originalTracks) {
        if (targetTracks.has(track)) return true;
      }
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

    try {
      const parseAIJson = (text: string): any => {
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
      };

      const assertNoIllegalOutput = (text: string): void => {
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
      };

      const nonJobPrompt = isEnglish
        ? generateEnglishNonJobPrompt(promptContext)
        : generateChineseNonJobPrompt(promptContext);

      const nonJobResponse = await this.gemini.generateContent(nonJobPrompt, (text) => {
        assertNoIllegalOutput(text);

        try {
          const data = parseAIJson(text);
          const requiredFields = ['position', 'yearsOfExperience', 'personalIntroduction', 'professionalSkills'];
          for (const field of requiredFields) {
            if (isIllegal(data[field])) {
              throw new Error(`关键字段 "${field}" 内容非法、缺失或包含无效嵌套内容`);
            }
          }

          if (!Array.isArray(data.workExperience) || data.workExperience.length === 0) {
            throw new Error('workExperience 不能为空');
          }

          const invalidSkeleton = data.workExperience.some((exp: any) =>
            isIllegal(exp.company) || isIllegal(exp.position) || isIllegal(exp.startDate) || isIllegal(exp.endDate)
          );
          if (invalidSkeleton) {
            throw new Error('workExperience 骨架字段不完整');
          }

          const existingMap = new Map<string, { jobTitle: string }>();
          (profile.workExperiences || []).forEach((exp: any) => {
            const key = buildExpKey(exp.company, exp.startDate, exp.endDate);
            existingMap.set(key, { jobTitle: exp.jobTitle || '' });
          });

          data.workExperience.forEach((exp: any, idx: number) => {
            const key = buildExpKey(exp.company, exp.startDate, exp.endDate);
            const original = existingMap.get(key);
            if (!original?.jobTitle) return;

            if (isFunctionallyCloseTitle(original.jobTitle, targetTitle)) {
              const generatedTitleNorm = normalizeTitleForCompare(exp.position || '');
              const originalTitleNorm = normalizeTitleForCompare(original.jobTitle || '');
              if (generatedTitleNorm !== originalTitleNorm) {
                console.warn(`同赛道岗位名未保留（index=${idx}, original=${original.jobTitle}, generated=${exp.position}），仅记录不触发重试`);
              }
            }
          });

          if (!needsSupplement) {
            const existingCount = (profile.workExperiences || []).length;
            const generatedCount = data.workExperience.length;
            if (generatedCount !== existingCount) {
              throw new Error(`无需补充经历，但生成岗位数不一致（existing=${existingCount}, generated=${generatedCount}），触发重试`);
            }
          }

          if (!isEnglish) {
            if (data.professionalSkills.length !== 4) {
              throw new Error("AI 生成的技能分类数量不足 4 组，触发重试");
            }

            const hasWrongSkillItemCount = data.professionalSkills.some((cat: any) =>
              !cat.items || cat.items.length !== 4
            );
            if (hasWrongSkillItemCount) {
              throw new Error("AI 生成的技能点数量不足 4 条/组，触发重试");
            }
          }

          return true;
        } catch (e: any) {
          throw new Error(`非职责阶段校验未通过: ${e.message}`);
        }
      });

      const nonJobData = parseAIJson(nonJobResponse);
      const workSkeleton: BulletPhaseWorkExperience[] = (nonJobData.workExperience || []).map((exp: any) => ({
        company: exp.company,
        position: exp.position,
        startDate: exp.startDate,
        endDate: exp.endDate,
      }));

      const jobBulletPrompt = isEnglish
        ? generateEnglishJobBulletPrompt(promptContext, workSkeleton)
        : generateChineseJobBulletPrompt(promptContext, workSkeleton);

      const jobBulletResponse = await this.gemini.generateContent(jobBulletPrompt, (text) => {
        assertNoIllegalOutput(text);

        try {
          const data = parseAIJson(text);
          if (!Array.isArray(data.workExperience)) {
            throw new Error('workExperience 必须为数组');
          }

          if (data.workExperience.length !== workSkeleton.length) {
            throw new Error(`职责阶段岗位数不一致（expected=${workSkeleton.length}, got=${data.workExperience.length}）`);
          }

          data.workExperience.forEach((exp: any, idx: number) => {
            const base = workSkeleton[idx];
            if (!base) {
              throw new Error(`职责阶段存在越界岗位 index=${idx}`);
            }

            if (exp.company !== base.company || exp.position !== base.position || exp.startDate !== base.startDate || exp.endDate !== base.endDate) {
              throw new Error(`职责阶段非法修改岗位骨架 index=${idx}`);
            }

            if (!Array.isArray(exp.responsibilities) || exp.responsibilities.length !== 8) {
              throw new Error(`职责数量不足 8 条 index=${idx}`);
            }

            const hasIllegalResp = exp.responsibilities.some((item: any) => isIllegal(item));
            if (hasIllegalResp) {
              throw new Error(`职责内容存在非法值 index=${idx}`);
            }
          });

          return true;
        } catch (e: any) {
          throw new Error(`职责阶段校验未通过: ${e.message}`);
        }
      });

      const bulletData = parseAIJson(jobBulletResponse);
      const mergedWorkExperience = workSkeleton.map((baseExp, idx) => ({
        ...baseExp,
        responsibilities: bulletData.workExperience[idx]?.responsibilities || [],
      }));

      const enhancedData = {
        ...nonJobData,
        workExperience: mergedWorkExperience,
      };

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

    const prompt = generateExtractionPrompt(text || "");

    try {
        let result = "";
        if (text) {
            // Text-only mode
            console.log(`[AI-Parse] Using Text Mode (${text.length} chars)`);
            result = await this.gemini.generateContent(prompt);
        } else {
            // Vision mode
            console.log(`[AI-Parse] Using Vision Mode (Image binary size: ${fileBuffer.length} bytes)`);
            parts.push({ text: prompt });
            result = await this.gemini.generateContentWithParts(parts);
        }

        console.log(`[AI-Parse] Gemini raw output: ${result.substring(0, 300)}...`);
        const parsed = this.parseResumeJSON(result);
        return parsed;
    } catch (e: any) {
        console.error("Gemini Extraction Failed", e);
        // 如果自定义错误，直接抛出，否则抛出通用错误
        if (e.message.includes("无效内容")) {
             throw e;
        }
        throw new Error("AI 解析简历失败: " + e.message);
    }
  }

  private extractJSON(text: string): any {
      let data: any = {};
      try {
          // Remove Markdown Code Blocks if present
          const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
              data = JSON.parse(jsonMatch[0]);
          } else {
              data = JSON.parse(cleanText);
          }
          return data;
      } catch (e) {
          console.error("Failed to parse AI JSON response", text);
          throw new Error("解析失败，AI返回格式错误");
      }
  }

  private parseResumeJSON(text: string): any {
      const data = this.extractJSON(text);

      // Handle Bilingual Format
      if (data.zh && data.en) {
          // Normalize both versions
          this.normalizeParsedProfile(data.zh);
          this.normalizeParsedProfile(data.en);

          // Validation based on detected language or zh
          const detectLang = data.language === 'english' ? 'en' : 'zh';
          const target = data[detectLang] || data.zh;
          
          this.validateProfile(target);

          // Return all blocks but flatten the detected language to top level for backward compatibility
          return {
              mobile: data.mobile || "",
              email: data.email || "",
              website: data.website || "",
              ...target,
              language: data.language,
              zh: data.zh,
              en: data.en
          };
      }

      // Fallback for old single-language format (if any)
      this.normalizeParsedProfile(data);
      this.validateProfile(data);
      return {
          ...data,
          zh: data.zh || data, // Ensure nesting exists for frontend
          en: data.en || data
      };
  }

  private normalizeParsedProfile(profile: any) {
      if (!profile) return;

      // 1. Merge projects into experience if they exist (defensive)
      if (profile.projects && Array.isArray(profile.projects) && profile.projects.length > 0) {
          if (!profile.experience) profile.experience = [];
          
          profile.projects.forEach((proj: any) => {
              const isDuplicate = profile.experience.some((exp: any) => 
                  (exp.company === proj.name || exp.description === proj.description)
              );
              
              if (!isDuplicate) {
                  profile.experience.push({
                      company: proj.name || (profile.language === 'en' ? 'Project' : '项目经验'),
                      role: proj.role || (profile.language === 'en' ? 'Contributor' : '项目成员'),
                      startTime: proj.startTime,
                      endTime: proj.endTime,
                      description: proj.description
                  });
              }
          });
          profile.projects = [];
      }
  }

  private validateProfile(data: any) {
      const hasBasicInfo = (data.name && data.name.length > 0) || (data.mobile && data.mobile.length > 0) || (data.email && data.email.length > 0);
      const hasExperience = data.experience && Array.isArray(data.experience) && data.experience.length > 0;
      const hasEducation = data.education && Array.isArray(data.education) && data.education.length > 0;
      const hasSkills = data.skills && Array.isArray(data.skills) && data.skills.length > 0;
      
      if (!hasBasicInfo && !hasExperience && !hasEducation && !hasSkills) {
          throw new Error("无效内容: 未能从文件中提取到有效的简历信息");
      }
  }

  /**
   * 从截图/图片或PDF中提取职位信息 (JD, Title, Years)
   */
  async extractJobInfoFromScreenshot(fileBuffer: Buffer, mimeType: string): Promise<any> {
    const prompt = `
    You are an expert Job Description Parser. 
    Analyze the provided job posting (image or PDF document) and extract the following key information into a strictly valid JSON object.
    
    The JSON structure must be:
    {
      "title": "Job Title (e.g. Senior Frontend Engineer)",
      "years": 3, // Experience requirement in years (number). See Rule #2.
      "description": "Full job description text including responsibilities and requirements."
    }
    
    Rules:
    1. "title": Extract the main job title. If exact title is not visible but can be inferred from the description, generate a suitable title. If absolutely no job info is present, leave empty string.
    2. "years": Extract the required professional experience in years. 
       - If a range is given (e.g., "3-5 years"), use the upper bound (5).
       - If multiple requirements exist (e.g., "3 years in specific skill" AND "5 years in industry"), choose the GENERAL INDUSTRY experience or the HIGHER number that defines the role's seniority.
       - If "No experience" or not mentioned, return null. Do NOT use 0 unless explicitly stated "0 years" or "No experience required".
    3. "description": Extract the full responsibility and requirement text. If unable to extract text or image is unclear, return empty string.
    4. Only return the JSON. No markdown.
    `;

    try {
        let parts: any[] = [];
        let data: any;

        // 直接使用 Gemini 的原生文档理解能力 (Vision/Multimodal)
        // Gemini Pro 模型对 PDF 的理解包含 OCR 和布局分析，比本地 pdf-parse 更强（尤其是扫描件和多栏排版）
        console.log(`[JobParse] 发送文件给 Gemini 进行原生解析 (Mime: ${mimeType}, Size: ${fileBuffer.length})`);
        
        parts = [
            { text: prompt },
            {
                inlineData: {
                    mimeType,
                    data: fileBuffer.toString('base64')
                }
            }
        ];
        
        const result = await this.gemini.generateContentWithParts(parts);
        data = this.extractJSON(result);
        
        // Normalize
        if (data.years !== null && typeof data.years !== 'number') {
            const parsed = parseInt(data.years);
            data.years = isNaN(parsed) ? null : parsed;
        }
        
        return data;
    } catch (e: any) {
        console.error("Gemini Job Extraction Failed", e);
        throw new Error("岗位截图解析失败: " + e.message);
    }
  }
}
