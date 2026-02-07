/**
 * 联系方式
 */
export interface ContactInfo {
  /** 电话 */
  phone?: string;
  /** 邮箱 */
  email?: string;
  /** 微信 */
  wechat?: string;
  /** 个人网站 */
  website?: string;
  /** 领英 */
  linkedin?: string;
  /** 电报 */
  telegram?: string;
  /** 地址 */
  location?: string;
}

/**
 * 教育背景
 */
export interface Education {
  /** 学校名称 */
  school: string;
  /** 学位/专业 */
  degree?: string;
  /** 毕业时间（格式：YYYY-MM 或 YYYY） */
  graduationDate: string;
  /** 其他描述/成就（可选） */
  description?: string;
}

/**
 * 工作经历
 */
export interface WorkExperience {
  /** 公司名称 */
  company: string;
  /** 职位 */
  position: string;
  /** 开始时间（格式：YYYY-MM） */
  startDate: string;
  /** 结束时间（格式：YYYY-MM 或 "至今"） */
  endDate: string;
  /** 工作职责和成就（数组，每个元素是一个要点） */
  responsibilities?: string[];
}

/**
 * 专业技能分类
 */
export interface SkillCategory {
  /** 技能分类标题 */
  title: string;
  /** 技能要点列表 */
  items: string[];
}

/**
 * 证书
 */
export interface Certificate {
  /** 证书名称 */
  name: string;
  /** 获取时间（可选，格式：YYYY-MM 或 YYYY） */
  date?: string;
  /** 成绩或描述（可选，如"580分"、"94/100"） */
  score?: string;
}

/**
 * 简历数据
 */
export interface ResumeData {
  /** 姓名 */
  name: string;
  /** 岗位 */
  position: string;
  /** 性别 */
  gender?: string;
  /** 联系方式 */
  contact: ContactInfo;
  /** 几年经验 */
  yearsOfExperience: number;
  /** 语言能力（可选，如"中英双语"） */
  languages?: string;
  /** 头像（可选，支持 URL 或 Base64 格式，如 "https://example.com/avatar.jpg" 或 "data:image/jpeg;base64,..."） */
  avatar?: string;
  /** 教育背景（可以多个） */
  education: Education[];
  /** 个人介绍 */
  personalIntroduction: string;
  /** 专业技能（可选） */
  professionalSkills?: SkillCategory[];
  /** 工作经历 */
  workExperience: WorkExperience[];
  /** 证书（可选） */
  certificates?: Certificate[];
}

/**
 * 岗位信息 (Job Data)
 */
export interface JobData {
  _id: string;
  title: string;
  title_chinese: string;
  title_english: string;
  team: string;
  summary: string;
  summary_chinese: string[];
  summary_english: string[];
  salary: string;
  salary_english: string;
  createdAt: string;
  source_name: string;
  source_name_english: string;
  source_url: string;
  type: string;
  description: string;
  description_chinese: string;
  description_english: string;
  city: string;
  experience: string;
}

/**
 * 用户简历资料 (Resume Profile)
 */
export interface UserResumeProfile {
  name: string;
  photo: string; // HTTPS URL or Base64 DataURL
  gender: string;
  birthday: string; // YYYY-MM
  wechat: string;
  email: string;
  phone: string;
  educations: {
    school: string;
    degree: string;
    major: string;
    startDate: string;
    endDate: string;
    description: string;
  }[];
  workExperiences: {
    company: string;
    jobTitle: string;
    businessDirection: string;
    workContent?: string;
    startDate: string;
    endDate: string;
  }[];
  certificates: string[];
  skills: string[];
  aiMessage: string;
  website?: string;
  linkedin?: string;
  telegram?: string;
  location?: string;
  phone_en?: string;
}

/**
 * 前端发送的生成请求体
 */
export interface GenerateFromFrontendRequest {
  jobId: string;
  openid: string; // Standardized from userId
  language?: string;
  resume_profile: UserResumeProfile;
  job_data: JobData;
  enhancedData?: ResumeData; // 用于物理文件过期后的快速恢复（免AI调用）
}

/**
 * 集中管理数据转换逻辑
 */
export function mapFrontendRequestToResumeData(payload: GenerateFromFrontendRequest): ResumeData {
  const profile = payload.resume_profile;
  const job = payload.job_data;
  const isEnglish = payload.language === 'english';

  // 处理姓名映射 (中文环境不再在名字后面拼性别)
  let displayName = profile.name;

  return {
    name: displayName,
    position: isEnglish ? (job.title_english || job.title) : (job.title_chinese || job.title),
    gender: profile.gender,
    contact: {
      email: profile.email,
      wechat: profile.wechat,
      phone: profile.phone,
      website: profile.website,
      linkedin: profile.linkedin,
      telegram: profile.telegram,
      location: profile.location,
    },
    avatar: profile.photo,
    languages: isEnglish ? 'english' : 'chinese',
    yearsOfExperience: 0, 
    education: profile.educations.map(edu => {
      let degree = edu.degree;

      if (!isEnglish && degree.includes('全日制') && !degree.includes('非全日制')) {
        degree = degree.replace(/\s*\(全日制\)\s*/g, '').replace(/全日制/g, '').trim();
      }
      
      return {
        school: edu.school,
        degree: isEnglish ? `${edu.major}, ${degree}` : `${edu.major} ${degree}`,
        graduationDate: `${edu.startDate} - ${edu.endDate}`,
        description: edu.description
      };
    }),
    personalIntroduction: "", 
    workExperience: profile.workExperiences.map(exp => ({
      company: exp.company,
      position: exp.jobTitle,
      startDate: exp.startDate,
      endDate: exp.endDate,
      responsibilities: [] 
    })),
    certificates: (profile.certificates || []).map(cert => ({
      name: cert
    }))
  };
}

