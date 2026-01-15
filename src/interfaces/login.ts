import { Router, Request, Response } from 'express';
import axios from 'axios';
import { ensureUser } from '../userUtils';

const router = Router();

// Retrieve from environment variables
const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET; // This must be provided by user in .env

/**
 * Exchange code for openid
 * POST /api/login
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Missing code' });
    }

    let openid: string;

    // Real WeChat API call
    const response = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: WX_APPID,
        secret: WX_SECRET,
        js_code: code,
        grant_type: 'authorization_code'
      },
      timeout: 10000 // 10s timeout for WeChat API
    });

    if (response.data.errcode) {
      return res.status(400).json({ 
        success: false, 
        message: 'WeChat API error: ' + response.data.errmsg, 
        error: response.data 
      });
    }

    openid = response.data.openid;

    const user = await ensureUser(openid);

    res.json({
      success: true,
      result: {
        openid,
        user
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;