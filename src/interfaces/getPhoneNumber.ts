import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getAccessToken } from '../utils/wechatUtils';
import { getDb } from '../db';

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

    await db.collection('users').updateOne(
      { openid: userOpenId },
      { 
        $set: { 
          phone_info: phoneInfo,
          phoneNumber: phoneInfo.phoneNumber,
          purePhoneNumber: phoneInfo.purePhoneNumber,
          countryCode: phoneInfo.countryCode,
          updatedAt: new Date()
        } 
      },
      { upsert: true }
    );

    // 4. 返回结果
    res.json({
      success: true,
      result: {
        ok: true,
        phone: phoneInfo.phoneNumber,
        countryCode: phoneInfo.countryCode
      }
    });

  } catch (error: any) {
    console.error('getPhoneNumber internal error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

export default router;
