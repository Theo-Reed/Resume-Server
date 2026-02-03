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
 * 检查用户是否在测试用户白名单中
 */
export async function isTestUser(openid: string): Promise<boolean> {
  if (!openid) return false;
  const db = getDb();
  const count = await db.collection('test_users').countDocuments({ openid });
  return count > 0;
}
