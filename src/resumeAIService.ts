import { GeminiService } from "./geminiService";
import { GenerateFromFrontendRequest, ResumeData, mapFrontendRequestToResumeData } from "./types";
import { generateChinesePrompt } from "./prompts/ChinesePrompt";
import { generateEnglishPrompt } from "./prompts/EnglishPrompt";

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

    // 1. 计算最早可工作时间
    const birthYear = parseInt(profile.birthday?.split('-')[0] || "2000");
    const earliestWorkYear = birthYear + 19;
    const earliestWorkDate = `${earliestWorkYear}-07`;

    // 2. 计算实际工作年限
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    let totalMonths = 0;
    
    profile.workExperiences.forEach(exp => {
      const start = exp.startDate.split('-');
      const startYear = parseInt(start[0]);
      const startMonth = parseInt(start[1]);
      let endYear, endMonth;
      
      if (exp.endDate === '至今') {
        endYear = currentYear;
        endMonth = currentMonth;
      } else {
        const end = exp.endDate.split('-');
        endYear = parseInt(end[0]);
        endMonth = parseInt(end[1]);
      }
      
      const months = (endYear - startYear) * 12 + (endMonth - startMonth);
      totalMonths += months;
    });
    
    const actualYears = Math.floor(totalMonths / 12);
    const actualMonths = totalMonths % 12;
    const actualExperienceText = actualMonths > 0 ? `${actualYears}年${actualMonths}个月` : `${actualYears}年`;

    // 3. 解析岗位要求的年限
    const parseExperienceRequirement = (req: string): { min: number; max: number } => {
      const match = req.match(/(\d+)-(\d+)年/);
      if (match) {
        return { min: parseInt(match[1]), max: parseInt(match[2]) };
      }
      const singleMatch = req.match(/(\d+)年以上/);
      if (singleMatch) {
        return { min: parseInt(singleMatch[1]), max: 999 };
      }
      return { min: 0, max: 999 };
    };
    
    const requiredExp = parseExperienceRequirement(job.experience);
    const needsSupplement = actualYears < requiredExp.min;
    const supplementYears = needsSupplement ? requiredExp.min - actualYears : 0;
    
    // 计算补充工作经历的时间段（考虑现有工作经历之间的间隔）
    let supplementSegments: Array<{ startDate: string; endDate: string; years: number }> = [];
    if (needsSupplement && profile.workExperiences.length > 0) {
      // 将现有工作经历按开始时间排序（从早到晚）
      const sortedExistingExps = [...profile.workExperiences].sort((a, b) => {
        return a.startDate.localeCompare(b.startDate);
      });
      
      // 找到最早的工作经历开始时间
      const earliestExp = sortedExistingExps[0].startDate;
      
      // 计算可以插入补充经历的位置（两段工作之间间隔 >= 4个月）
      const insertPositions: Array<{ afterEnd: string; beforeStart: string; gapMonths: number }> = [];
      
      // 检查每两段工作经历之间的间隔
      for (let i = 0; i < sortedExistingExps.length - 1; i++) {
        const currentExp = sortedExistingExps[i];
        const nextExp = sortedExistingExps[i + 1];
        
        const currentEnd = currentExp.endDate === '至今' 
          ? `${currentYear}-${String(currentMonth).padStart(2, '0')}` 
          : currentExp.endDate;
        const nextStart = nextExp.startDate;
        
        // 计算间隔月数
        const endDate = new Date(currentEnd + '-01');
        const startDate = new Date(nextStart + '-01');
        const gapMonths = (startDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        
        // 如果间隔 >= 4个月，记录这个位置
        if (gapMonths >= 4) {
          insertPositions.push({
            afterEnd: currentEnd,
            beforeStart: nextStart,
            gapMonths: Math.floor(gapMonths)
          });
        }
      }
      
      // 从最早工作经历往前推，补充工作经历
      let remainingYears = supplementYears;
      let currentEnd = earliestExp;
      
      // 先尝试在现有工作经历之间的间隔中插入补充经历
      for (const pos of insertPositions) {
        if (remainingYears <= 0) break;
        
        // 计算可以在这个间隔中插入多少年
        const availableYears = Math.min(remainingYears, pos.gapMonths / 12, 3); // 最多3年，且不超过间隔
        
        if (availableYears >= 0.5) { // 至少半年才值得插入
          const endDate = new Date(pos.beforeStart + '-01');
          endDate.setMonth(endDate.getMonth() - 1); // 往前推1个月，避免重叠
          const startDate = new Date(endDate);
          startDate.setFullYear(startDate.getFullYear() - Math.floor(availableYears));
          
          // 确保不早于前一段工作的结束时间
          const prevEndDate = new Date(pos.afterEnd + '-01');
          if (startDate < prevEndDate) {
            startDate.setTime(prevEndDate.getTime());
            startDate.setMonth(startDate.getMonth() + 1); // 往后推1个月，避免重叠
          }
          
          const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
          const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
          
          // 计算实际的工作年限（考虑月份）
          const actualMonths = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
          const actualYearsForSegment = Math.floor(actualMonths / 12);
          
          if (actualYearsForSegment > 0) {
            supplementSegments.push({
              startDate: startStr,
              endDate: endStr,
              years: actualYearsForSegment
            });
            remainingYears -= actualYearsForSegment;
          }
        }
      }
      
      // 如果还需要补充，从最早工作经历往前推
      while (remainingYears > 0) {
        const segmentYears = Math.min(remainingYears, 3); // 每段最多3年
        const endDate = new Date(currentEnd + '-01');
        endDate.setMonth(endDate.getMonth() - 1); // 往前推1个月，避免重叠
        const startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - segmentYears);
        
        // 检查是否早于最早可工作日期
        const earliestWorkDateObj = new Date(earliestWorkDate + '-01');
        if (startDate < earliestWorkDateObj) {
          startDate.setTime(earliestWorkDateObj.getTime());
          // 如果被限制了，重新计算实际的工作年限
          const actualSegmentMonths = Math.max(0, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
          const actualSegmentYears = Math.floor(actualSegmentMonths / 12);
          remainingYears -= actualSegmentYears;
          if (actualSegmentYears <= 0) {
            break; // 如果无法再补充，退出循环
          }
        } else {
          remainingYears -= segmentYears;
        }
        
        const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
        const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
        
        // 计算实际的工作年限（考虑月份）
        const actualMonths = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        const actualYearsForSegment = Math.floor(actualMonths / 12);
        
        supplementSegments.push({
          startDate: startStr,
          endDate: endStr,
          years: actualYearsForSegment
        });
        
        currentEnd = startStr;
      }
    }
    
    // 构建所有工作经历的时间线（用于排序和插入位置判断）
    const allWorkExperiences: Array<{ startDate: string; endDate: string; type: 'existing' | 'supplement'; index?: number }> = [];
    
    // 添加现有工作经历
    profile.workExperiences.forEach((exp, idx) => {
      allWorkExperiences.push({
        startDate: exp.startDate,
        endDate: exp.endDate === '至今' ? `${currentYear}-${String(currentMonth).padStart(2, '0')}` : exp.endDate,
        type: 'existing',
        index: idx
      });
    });
    
    // 添加补充工作经历
    supplementSegments.forEach(seg => {
      allWorkExperiences.push({
        startDate: seg.startDate,
        endDate: seg.endDate,
        type: 'supplement'
      });
    });
    
    // 按开始时间倒序排序（最新的在最前面）
    allWorkExperiences.sort((a, b) => {
      const dateA = new Date(a.startDate + '-01').getTime();
      const dateB = new Date(b.startDate + '-01').getTime();
      return dateB - dateA; // 倒序：最新的在前
    });

    // 4. 构造 Prompt
    const promptContext = {
      targetTitle,
      job,
      requiredExp,
      profile,
      earliestWorkDate,
      actualExperienceText,
      totalMonths,
      needsSupplement,
      actualYears,
      supplementYears,
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
        position: targetTitle, // 依然强制使用我们预期的标题
        yearsOfExperience: enhancedData.yearsOfExperience,
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
