import WxPay from 'wechatpay-node-v3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Types workaround (use any)
type IRequestParams = any;

const privateKeyPath = process.env.WX_PRIVATE_KEY_PATH || 'apiclient_key.pem';
const publicCertPath = process.env.WX_PUBLIC_CERT_PATH || 'apiclient_cert.pem';

let pay: any = null;
let privateKeyContent: Buffer | null = null;
let publicCertContent: Buffer | null = null;

export const getWxPayClient = (): any => {
  if (pay) return pay;

  try {
    const pkPath = path.resolve(process.cwd(), privateKeyPath);
    const pubPath = path.resolve(process.cwd(), publicCertPath);
    
    if (!fs.existsSync(pkPath)) {
        throw new Error('Merchant private key file not found at ' + pkPath);
    }
    if (!fs.existsSync(pubPath)) {
        throw new Error('Public key/cert file not found at ' + pubPath);
    }

    privateKeyContent = fs.readFileSync(pkPath);
    publicCertContent = fs.readFileSync(pubPath);

    pay = new WxPay({
      appid: process.env.WX_APPID || '',
      mchid: process.env.WX_MCHID || '',
      publicKey: publicCertContent,
      privateKey: privateKeyContent,
      key: process.env.WX_API_V3_KEY || '',
      serial_no: process.env.WX_CERT_SERIAL_NO || '',
    });

    return pay;
  } catch (error) {
    throw error;
  }
};

export const hasWxConfig = () => {
    try {
        const pkPath = path.resolve(process.cwd(), privateKeyPath);
        const pubPath = path.resolve(process.cwd(), publicCertPath);
        return fs.existsSync(pkPath) && fs.existsSync(pubPath) && !!process.env.WX_APPID && !!process.env.WX_MCHID;
    } catch { return false; }
}

export const getMiniProgramPaymentParams = async (
  description: string,
  out_trade_no: string,
  amount: { total: number; currency: 'CNY' },
  openid: string
) => {
  const client = getWxPayClient();

  // Create Unified Order
  const params: IRequestParams = {
    description,
    out_trade_no,
    notify_url: process.env.WX_NOTIFY_URL || 'http://127.0.0.1:3000/api/payCallback',
    amount,
    payer: {
      openid,
    },
  };

  const result = await client.transactions_jsapi(params);
  
  if (result.status !== 200 && result.status !== 204 && result.status !== 202) {
      console.error('WxPay Error:', result.data);
      throw new Error(`WeChat Pay API Error: ${result.status}`);
  }

  const { prepay_id } = result.data as any;
  if (!prepay_id) {
      throw new Error('No prepay_id returned from WeChat Pay');
  }

  // Generate Sign for Mini Program
  const appId = process.env.WX_APPID || '';
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageStr = `prepay_id=${prepay_id}`;
  
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
  
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  const paySign = signer.sign(privateKeyContent!, 'base64');

  return {
    timeStamp,
    nonceStr,
    package: packageStr,
    signType: 'RSA',
    paySign
  };
};

export const verifyNotification = async (headers: any, bodyVal: any) => {
    const client = getWxPayClient();
    try {
        await client.verify({
            timestamp: headers['wechatpay-timestamp'],
            nonce: headers['wechatpay-nonce'],
            body: typeof bodyVal === 'string' ? bodyVal : JSON.stringify(bodyVal),
            signature: headers['wechatpay-signature'],
            serial: headers['wechatpay-serial'],
        });
        
        return typeof bodyVal === 'string' ? JSON.parse(bodyVal) : bodyVal;
    } catch (e) {
        console.error('Verify failed', e);
        throw e;
    }
}

export const decipherNotification = (resource: any) => {
    const client = getWxPayClient();
    const { ciphertext, nonce, associated_data } = resource;
    const apiv3Key = process.env.WX_API_V3_KEY || '';
    
    return client.decipher_gcm(ciphertext, associated_data, nonce, apiv3Key);
}