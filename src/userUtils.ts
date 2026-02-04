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
  const db = getDb();
  const count = await db.collection('test_users').countDocuments({ openid });
  return count > 0;
}
