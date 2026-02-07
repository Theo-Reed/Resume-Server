import WxPay from 'wechatpay-node-v3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Types workaround (use any)
type IRequestParams = any;

const privateKeyPath = process.env.WX_PRIVATE_KEY_PATH || 'apiclient_key.pem';
// FIX: .env uses 'pub_key.pem' for WX_PUBLIC_CERT_PATH, but file on disk is 'apiclient_cert.pem' for the cert?
// Actually 'pub_key.pem' usually refers to the platform public key, while 'apiclient_cert.pem' is the merchant cert.
// However, WxPay init requires the merchant cert content as 'publicKey' (or 'cert' in some libs).
// Looking at standard layout: apiclient_key.pem (Private), apiclient_cert.pem (Public Cert).
const publicCertPath = process.env.WX_MERCHANT_CERT_PATH || 'apiclient_cert.pem';

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
        // Correct logic to check file existence.
        // NOTE: In .env and index.ts, 'publicCertPath' defaults to 'apiclient_cert.pem' in index.ts
        // BUT in .env it is set to 'pub_key.pem'. This creates a CONFLICT.
        // We must check what the code actually USES.
        
        let pkPath = path.resolve(process.cwd(), privateKeyPath);
        let pubPath = path.resolve(process.cwd(), publicCertPath);
        
        // Debugging LOG (To help diagnose why it might be returning true wrongly or correctly)
        // console.log('[WxPay Config Check]', { pkPath, pubPath, appId: !!process.env.WX_APPID, mchId: !!process.env.WX_MCHID });

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
  const notifyUrl = process.env.WX_NOTIFY_URL;
  if (!notifyUrl) {
      throw new Error("WX_NOTIFY_URL environment variable is not defined");
  }

  const params: IRequestParams = {
    description,
    out_trade_no,
    notify_url: notifyUrl,
    amount,
    payer: {
      openid,
    },
  };

  const result = await client.transactions_jsapi(params);
  
  if (result.status !== 200 && result.status !== 204 && result.status !== 202) {
      console.error('WxPay Error:', result.data);
      throw new Error(`WeChat Pay API Error: ${result.status} ${JSON.stringify(result.data)}`);
  }

  // Handle wechatpay-node-v3 automatic signing (Version 2.x+)
  // The library often returns the full signed object directly in result.data
  if (result.data && result.data.paySign && result.data.package) {
      return {
          timeStamp: result.data.timeStamp,
          nonceStr: result.data.nonceStr,
          package: result.data.package,
          signType: result.data.signType || 'RSA',
          paySign: result.data.paySign
      };
  }

  const { prepay_id } = result.data as any;
  if (!prepay_id) {
      console.error('Incompatible WeChat Pay Response Structure:', result.data);
      throw new Error('No prepay_id returned from WeChat Pay and no signed params found');
  }

  // Generate Sign for Mini Program (Fallback for older versions or different configurations)
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
        // bodyVal could be: Buffer (raw), string, or object.
        // V3 verification strictly requires original raw body string.
        let verifyBody: string;
        if (Buffer.isBuffer(bodyVal)) {
            verifyBody = bodyVal.toString('utf8');
        } else if (typeof bodyVal === 'string') {
            verifyBody = bodyVal;
        } else {
            verifyBody = JSON.stringify(bodyVal);
        }

        await client.verify({
            timestamp: headers['wechatpay-timestamp'],
            nonce: headers['wechatpay-nonce'],
            body: verifyBody,
            signature: headers['wechatpay-signature'],
            serial: headers['wechatpay-serial'],
        });
        
        return true;
    } catch (e) {
        console.error('[WxPay] Verify failed:', e);
        throw e;
    }
}

export const decipherNotification = (resource: any) => {
    const client = getWxPayClient();
    const { ciphertext, nonce, associated_data } = resource;
    const apiv3Key = process.env.WX_API_V3_KEY || '';
    
    return client.decipher_gcm(ciphertext, associated_data, nonce, apiv3Key);
}

export const queryOrder = async (out_trade_no: string) => {
    const client = getWxPayClient();
    try {
        const mchid = process.env.WX_MCHID || '';
        let result: any;
        
        // Comprehensive detection for wechatpay-node-v3 methods
        // Versions vary greatly in where they mount the transactions methods
        if (typeof client.transactions_out_trade_no === 'function') {
            result = await client.transactions_out_trade_no(out_trade_no, { mchid });
        } else if (client.v3 && client.v3.pay && client.v3.pay.transactions && typeof client.v3.pay.transactions.out_trade_no === 'function') {
            result = await client.v3.pay.transactions.out_trade_no(out_trade_no, { mchid });
        } else if (typeof client.query === 'function') {
            result = await client.query({ out_trade_no });
        } else {
            // Raw GET request fallback using the underlying request mechanism if available
            console.log('[WxPay] Standard methods not found, trying underlying request...');
             result = await client.get(`/v3/pay/transactions/out-trade-no/${out_trade_no}`, {
                params: { mchid }
            });
        }
        
        if (result && result.status === 200 && result.data && result.data.trade_state) {
            return result.data; 
        } else {
            console.warn(`[WxPay] Query order ${out_trade_no} result status: ${result?.status}`, result?.data);
            return { error: true, status: result?.status, data: result?.data };
        }
    } catch (error: any) {
        console.error('[WxPay] Query Order Exception:', out_trade_no, error.message);
        
        // Debug: Log all available methods on client to help identify the correct one
        const methods = Object.keys(client).filter(k => typeof (client as any)[k] === 'function');
        console.log('[WxPay] Available client methods:', methods);
        
        return { error: true, message: error.message };
    }
}
