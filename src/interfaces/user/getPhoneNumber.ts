import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getAccessToken } from '../../utils/wechatUtils';
import { getDb } from '../../db';
import { generateToken } from '../auth/utils';
import { generateInviteCode } from '../../userUtils';

const router = Router();

// Used in: pages/me/index.ts, utils/phoneAuth.ts
router.post('/getPhoneNumber', async (req: Request, res: Response) => {
  try {
    const { code, openid } = req.body;
    // 尝试从 body 获取 openid，或者从 header 获取
    const userOpenId = openid || (req.headers['x-openid'] as string);

    if (!code) {
      return res.status(400).json({ success: false, message: 'Missing code' });
    }
    
    if (!userOpenId) {
       return res.status(400).json({ success: false, message: 'Missing openid' });
    }

    // 1. 获取 AccessToken
    const accessToken = await getAccessToken();

    // 2. 调用微信 getuserphonenumber 接口
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`;
    
    const response = await axios.post(url, { code });

    if (response.data.errcode && response.data.errcode !== 0) {
       console.error('WeChat getPhoneNumber API Error:', response.data);
       return res.status(400).json({ 
         success: false, 
         message: 'WeChat API Error: ' + response.data.errmsg,
         code: response.data.errcode
       });
    }

    const phoneInfo = response.data.phone_info;

    if (!phoneInfo) {
        return res.status(500).json({ success: false, message: 'No phone_info in WeChat response' });
    }

    // 3. 更新数据库
    const db = getDb();
    if (!db) {
        throw new Error('Database not initialized');
    }

    const usersCol = db.collection('users');
    const purePhone = phoneInfo.purePhoneNumber;

    // A. 查找是否存已有用户使用了该手机号
    const existingUser = await usersCol.findOne({ phone: purePhone });

    if (existingUser) {
        console.log(`[Auth] 手机号 ${purePhone} 已存在主账号，直接关联并登录`);
        
        // 扫地逻辑：确保该 OpenID 之前没有绑定在其他手机号下
        await usersCol.updateMany(
          { 
              _id: { $ne: existingUser._id }, 
              $or: [{ openid: userOpenId }, { openids: userOpenId }] 
          },
          { $pull: { openids: userOpenId } as any }
        );

        // 将当前 OpenID 关联到老账号 (使用 $addToSet 避免重复)
        await usersCol.updateOne(
            { _id: existingUser._id },
            { 
                $addToSet: { openids: userOpenId },
                $set: { updatedAt: new Date(), lastLoginTime: new Date() } 
            }
        );
    } else {
        // B. 新手机号，创建新用户
        console.log(`[Auth] 手机号 ${purePhone} 为新用户，创建账号并绑定 OpenID: ${userOpenId}`);
        
        // 扫地逻辑：确保该 OpenID 不再指向旧账号
        await usersCol.updateMany(
          { $or: [{ openid: userOpenId }, { openids: userOpenId }] },
          { $pull: { openids: userOpenId } as any, $unset: { openid: "" } }
        );

        // 计算 3 天后的会员过期时间
        const expireAt = new Date();
        expireAt.setDate(expireAt.getDate() + 3);

        const inviteCode = generateInviteCode(userOpenId);

        const newUser = {
            openid: userOpenId,
            openids: [userOpenId], // 初始化 OpenID 列表
            phone: purePhone,
            phone_info: phoneInfo,
            language: 'AIChinese',
            isAuthed: true, // 授权过手机号即视为已认证
            membership: { 
                level: 1, 
                expire_at: expireAt,
                pts_quota: { limit: 5, used: 0 }
            },
            inviteCode, // 个人邀请码
            hasUsedInviteCode: false, // 是否使用过别人的邀请码
            resume_profile: {},
            nickname: '丈月尺用户',
            avatar: '',
            createTime: new Date(),
            lastLoginTime: new Date(),
            updatedAt: new Date()
        };

        await usersCol.insertOne(newUser);
    }

    // 4. 获取最终用户信息并生成 Token (强制使用 phone 查找以确保拿到最新记录)
    const finalUser = await usersCol.findOne({ phone: purePhone });

    if (!finalUser) {
      throw new Error('Failed to retrieve user after update');
    }

    const token = generateToken({ 
      userId: finalUser._id.toString(), 
      phoneNumber: finalUser.phone || '' 
    });

    res.json({
      success: true,
      result: {
        token,
        isNewUser: !existingUser,
        phone: phoneInfo.purePhoneNumber,
        countryCode: phoneInfo.countryCode,
        user: {
          _id: finalUser._id,
          phone: finalUser.phone,
          phoneNumber: finalUser.phone,
          resume_profile: finalUser.resume_profile || finalUser.profile || {},
          language: finalUser.language,
          nickname: finalUser.nickname || '',
          avatar: finalUser.avatar || '',
          inviteCode: finalUser.inviteCode || '',
          membership: finalUser.membership,
          isAuthed: true
        }
      }
    });

  } catch (error: any) {
    console.error('getPhoneNumber internal error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
