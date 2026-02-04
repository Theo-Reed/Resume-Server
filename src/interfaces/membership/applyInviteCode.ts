import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { ensureUser } from '../../userUtils';

const router = Router();

/**
 * Apply an invitation code
 * POST /api/applyInviteCode
 */
router.post('/applyInviteCode', async (req: Request, res: Response) => {
  try {
    const { targetInviteCode } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid || !targetInviteCode) {
      return res.json({ success: false, message: '参数缺失' });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    // 1. 获取当前用户（受邀者）
    const invitee = await ensureUser(openid);
    if (!invitee) {
      return res.json({ success: false, message: '记录未找到' });
    }

    if ((invitee as any).hasUsedInviteCode) {
      return res.json({ success: false, message: '您已经填写过邀请码了' });
    }

    // 2. 找到邀请人 (邀请码现在区分大小写)
    const inviter = await usersCol.findOne({ inviteCode: targetInviteCode });
    if (!inviter) {
      return res.json({ success: false, message: '无效的邀请码' });
    }

    if (inviter.openid === openid) {
      return res.json({ success: false, message: '不能填写自己的邀请码' });
    }

    // 3. 执行奖励逻辑（增加 3 天会员 + 5 点算力）
    const rewardDays = 3;
    const rewardPoints = 5;

    // 更新受邀者
    let inviteeBaseDate = new Date();
    if (invitee.membership?.expire_at && new Date(invitee.membership.expire_at) > inviteeBaseDate) {
        inviteeBaseDate = new Date(invitee.membership.expire_at);
    }
    const inviteeNewExpireAt = new Date(inviteeBaseDate.getTime() + rewardDays * 24 * 60 * 60 * 1000);

    // 智能判断受邀者等级：如果不低于1级则保持原样，否则升级为1级
    const currentInviteeLevel = (invitee as any).membership?.level || 0;
    const newInviteeLevel = Math.max(currentInviteeLevel, 1);

    await usersCol.updateOne(
      { openid: invitee.openid },
      { 
        $set: { 
          hasUsedInviteCode: true,
          'membership.expire_at': inviteeNewExpireAt,
          'membership.level': newInviteeLevel
        },
        $inc: { 
          'membership.pts_quota.limit': rewardPoints
        }
      }
    );

    // 更新邀请人
    let inviterBaseDate = new Date();
    if (inviter.membership?.expire_at && new Date(inviter.membership.expire_at) > inviterBaseDate) {
        inviterBaseDate = new Date(inviter.membership.expire_at);
    }
    const inviterNewExpireAt = new Date(inviterBaseDate.getTime() + rewardDays * 24 * 60 * 60 * 1000);

    // 智能判断邀请者等级：如果不低于1级则保持原样，否则升级为1级
    const currentInviterLevel = inviter.membership?.level || 0;
    const newInviterLevel = Math.max(currentInviterLevel, 1);

    await usersCol.updateOne(
      { openid: inviter.openid },
      { 
        $set: { 
          'membership.expire_at': inviterNewExpireAt,
          'membership.level': newInviterLevel
        },
        $inc: { 
          'membership.pts_quota.limit': rewardPoints
        }
      }
    );

    res.json({
      success: true,
      message: `邀请码应用成功，双方各获得当前会员时长增加 ${rewardDays} 天及 ${rewardPoints} 点算力额度`,
      result: { success: true }
    });

  } catch (error) {
    console.error('applyInviteCode error:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

export default router;
