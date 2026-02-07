import { getDb } from './db';
import { createHash } from 'crypto';

/**
 * Generate a unique and deterministic invite code based on openid
 * Using Base62 (0-9, A-Z, a-z) for better entropy and professional look
 */
export function generateInviteCode(openid: string): string {
  const hashBuffer = createHash('md5').update(openid).digest();
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let code = '';
  // Use first 5 bytes (40 bits) for a huge range (~1 trillion)
  // 62^6 is ~56.8 billion, so 40 bits is plenty to fill 6-8 chars
  let val = BigInt('0x' + hashBuffer.subarray(0, 5).toString('hex'));
  for (let i = 0; i < 6; i++) {
    code += chars[Number(val % 62n)];
    val /= 62n;
  }
  return code;
}

export async function ensureUser(openid: string, userInfo: any = {}) {
  if (!openid || openid === 'undefined') {
    return null;
  }

  const db = getDb();
  const usersCol = db.collection('users');

  // 1. 查找是否存在该用户 (通过 openid 或 openids 数组)
  const user = await usersCol.findOne({
    $or: [
      { openid },
      { openids: openid }
    ]
  });

  if (user) {
    // 如果找到了，更新最后登录时间
    await usersCol.updateOne(
      { _id: user._id },
      { $set: { lastLoginTime: new Date() } }
    );
    return user;
  }

  // 2. 如果没找到，不再自动 upsert (避免创建空壳账号)
  // 用户只有在授权手机号后才会被正式创建
  return null;
}

/**
 * 计算简历完整度
 * @param profile 某个语言版本的简历对象 (zh 或 en)
 * @param lang 语言类型
 */
export function evaluateResumeCompleteness(profile: any, lang: 'zh' | 'en') {
  if (!profile) return { score: 0, level: 0 };
  
  let score = 0;
  const hasProfileData = Object.keys(profile).length > 0;
  
  // 1. 姓名: 10%
  if (profile.name) score += 10;
  
  // 2. 照片: 5%
  if (profile.photo) score += 5;
  
  // 3. 性别/生日: 5% + 5%
  if (profile.gender) score += 5;
  if (profile.birthday) score += 5;
  
  if (lang === 'zh') {
    const methods = ['wechat', 'phone', 'email'];
    const presentCount = methods.filter(k => !!profile[k]).length;
    if (presentCount > 0) {
      const per = Math.ceil(15 / methods.length);
      score += Math.min(per * presentCount, 15);
    }
  } else {
    // 英文版 数据库里的phone字段是不用的 只用phone_en
    const methods = ['email', 'phone_en', 'whatsapp', 'telegram', 'linkedin', 'website'];
    const presentCount = methods.filter(k => !!profile[k]).length;
    if (presentCount > 0) {
      const per = Math.ceil(15 / methods.length);
      score += Math.min(per * presentCount, 15);
    }
  }
  
  // 5. 教育经历: 20%
  if (Array.isArray(profile.educations) && profile.educations.length > 0) score += 20;
  
  // 6. 工作经历: 20%
  if (Array.isArray(profile.workExperiences) && profile.workExperiences.length > 0) score += 20;
  
  // 7. 技能: 10%
  if (Array.isArray(profile.skills) && profile.skills.length > 0) score += 10;
  
  // 8. 证书: 5%
  if (Array.isArray(profile.certificates) && profile.certificates.length > 0) score += 5;
  
  // 9. AI 指令: 5%
  if (profile.aiMessage) score += 5;
  
  if (hasProfileData) {
     console.log(`[evaluateResumeCompleteness] Lang: ${lang}, Score: ${score}, Fields: ${Object.keys(profile).join(',')}`);
  }

  // Level 1: 基础要求
  const hasName = !!profile.name;
  const hasEdu = Array.isArray(profile.educations) && profile.educations.length > 0;
  let hasContact = false;

  if (lang === 'zh') {
    // 中文：姓名、(手机、微信 或 邮箱 选一)、毕业院校
    hasContact = !!(profile.phone || profile.wechat || profile.email);
  } else {
    // 英文：姓名、(邮箱 或 手机 选一)、毕业院校
    hasContact = !!(profile.email || profile.phone_en);
  }
                   
  let level = 0;
  if (hasName && hasEdu && hasContact) {
    level = 1;
  }
  
  return { score, level };
}

/**
 * 标准化用户信息下发，并确保简历完整度是最新的
 * @param user 数据库中的原始用户对象
 */
export function formatUserResponse(user: any) {
  if (!user) return null;

  const profile = user.resume_profile || {};
  const zhProfile = profile.zh || {};
  const enProfile = profile.en || {};

  // 动态重新计算，确保下发的数据永远是最新的
  const zhCompleteness = evaluateResumeCompleteness(zhProfile, 'zh');
  const enCompleteness = evaluateResumeCompleteness(enProfile, 'en');

  // 构建标准化的简历 Profile，注入最新的完整度
  const resume_profile = {
    ...profile,
    zh: {
      ...zhProfile,
      completeness: zhCompleteness
    },
    en: {
      ...enProfile,
      completeness: enCompleteness
    }
  };

  return {
    _id: user._id,
    openid: user.openid || (user.openids && user.openids[0]),
    phone: user.phone || user.phoneNumber,
    phoneNumber: user.phone || user.phoneNumber,
    openids: user.openids || [user.openid],
    language: user.language || 'AIChinese',
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    membership: user.membership || { level: 0 },
    inviteCode: user.inviteCode || '',
    resume_profile: resume_profile,
    isAuthed: !!(user.phone || user.phoneNumber)
  };
}

/**
 * 获取物理上生效的 OpenID（处理账号合并重定向）
 */
export async function getEffectiveOpenid(openid: string): Promise<string> {
  if (!openid) return openid;
  const db = getDb();
  const user = await db.collection('users').findOne({ openid }, { projection: { primary_openid: 1 } });
  return (user as any)?.primary_openid || openid;
}

/**
 * 检查用户是否在测试用户白名单中
 */
export async function isTestUser(openid: string): Promise<boolean> {
  if (!openid) return false;
  
  // 灰度测试用户：硬编码白名单
  const whiteList = ['optpz19PPrkaBFsDFY6Zq3UqufcI'];
  if (whiteList.includes(openid)) return true;

  const db = getDb();
  const count = await db.collection('test_users').countDocuments({ openid });
  return count > 0;
}
