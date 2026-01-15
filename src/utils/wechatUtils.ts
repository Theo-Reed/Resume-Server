import axios from 'axios';

let accessToken: string = '';
let tokenExpiration: number = 0;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (accessToken && now < tokenExpiration) {
    return accessToken;
  }

  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;

  if (!appid || !secret) {
    throw new Error('Missing WX_APPID or WX_SECRET env variables');
  }

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const response = await axios.get(url);
    
    if (response.data.errcode) {
      throw new Error(`WeChat AccessToken Error: ${response.data.errmsg}`);
    }

    accessToken = response.data.access_token;
    // 有效期 7200 秒，我们提前 5 分钟刷新
    tokenExpiration = now + (response.data.expires_in - 300) * 1000;
    
    return accessToken;
  } catch (error) {
    console.error('Failed to get AccessToken', error);
    throw error;
  }
}
