import { getDb } from './db';
import { createHash } from 'crypto';

/**
 * Generate a unique and deterministic invite code based on openid
 * Using Base62 (0-9, A-Z, a-z) for better entropy and professional look
 */
function generateInviteCode(openid: string): string {
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

  // A. 首先检查是否存在主账号跳转 (影子账号逻辑)
  const existingUser = await usersCol.findOne({ openid });
  if (existingUser && existingUser.primary_openid) {
      const primaryUser = await usersCol.findOne({ openid: existingUser.primary_openid });
      if (primaryUser) {
          // console.log(`[User] 重定向影子账号 ${openid} -> 主账号 ${existingUser.primary_openid}`);
          return primaryUser;
      }
  }

  // B. 原有的初始化逻辑
  // Calculate 3 days from now
  const expireAt = new Date();
  expireAt.setDate(expireAt.getDate() + 3);

  const inviteCode = generateInviteCode(openid);

  const updateData = {
    $setOnInsert: {
      openid,
      language: 'AIChinese',
      isAuthed: false,
      membership: { 
        level: 1, // Start as trial member
        expire_at: expireAt,
        pts_quota: {
            limit: 5,
            used: 0
        }
      },
      inviteCode, // Personal invite code
      hasUsedInviteCode: false, // Record if this user has used someone else's code
      resume_profile: {},
      nickname: '丈月尺用户',
      avatar: '',
      createTime: new Date(),
      ...userInfo
    },
    $set: {
      lastLoginTime: new Date()
    }
  };

  const result = await usersCol.findOneAndUpdate(
    { openid },
    updateData as any,
    { upsert: true, returnDocument: 'after' }
  );

  if (result && (result as any).avatar === undefined) {
    (result as any).avatar = '';
  }

  return result;
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
