import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getAccessToken } from '../../utils/wechatUtils';
import { getDb } from '../../db';

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

    if (existingUser && existingUser.openid !== userOpenId) {
        console.log(`[Merge] 检测到手机号 ${purePhone} 已关联用户 ${existingUser.openid}，开始合并数据...`);
        
        // 1. 迁移所有业务数据
        const collectionsToMigrate = [
            'generated_resumes',
            'orders',
            'saved_jobs',
            'saved_search_conditions',
            'custom_jobs'
        ];

        for (const collName of collectionsToMigrate) {
            try {
                const migrateRes = await db.collection(collName).updateMany(
                    { openid: userOpenId },
                    { $set: { openid: existingUser.openid } }
                );
                if (migrateRes.matchedCount > 0) {
                    console.log(`   - 迁移 ${collName}: 已将 ${migrateRes.matchedCount} 条数据移动至主账号`);
                }
            } catch (err) {
                console.error(`   - 迁移 ${collName} 失败:`, err);
            }
        }

        // 2. 合并资产（目前主要合并 topup 额度）
        const currentUser = await usersCol.findOne({ openid: userOpenId });
        if (currentUser && currentUser.membership && currentUser.membership.topup_quota > 0) {
            await usersCol.updateOne(
                { openid: existingUser.openid },
                { 
                    $inc: { 
                        'membership.topup_quota': currentUser.membership.topup_quota,
                        'membership.topup_limit': currentUser.membership.topup_quota || 0
                    } 
                }
            );
            console.log(`   - 资产合并: 已将 ${currentUser.membership.topup_quota} 额度转入主账号`);
        }

        // 3. 更新当前账号为关联状态
        await usersCol.updateOne(
          { openid: userOpenId },
          { 
            $set: { 
              phone: purePhone,
              is_merged: true,
              primary_openid: existingUser.openid,
              updatedAt: new Date()
            },
            $unset: {
              phone_info: "" // 减少主备不一致风险，主账号存 phone_info 即可
            }
          }
        );

    } else {
        // B. 正常绑定（新手机号或已在该 OpenID 下）
        await db.collection('users').updateOne(
          { openid: userOpenId },
          { 
            $set: { 
              phone: purePhone,
              phone_info: phoneInfo,
              is_merged: false,
              primary_openid: null,
              updatedAt: new Date()
            },
            $unset: {
              phoneNumber: "",
              purePhoneNumber: "",
              countryCode: ""
            }
          },
          { upsert: true }
        );
    }

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
