# WeChat Pay V3 Integration Technical Notes

## Project Context
- **Base Command**: `wechatpay-node-v3` (v2.2.1)
- **Environment**: Node.js (CommonJS)
- **Identity Standard**: `openid` (stored in `x-openid` header or request body)

## Critical Fix: JSAPI Response Handling
The `wechatpay-node-v3` library (v2.x) automatically performs signing for JSAPI/Mini Program transactions.

### Issue
Previously, the code expected `result.data` to be the raw WeChat JSON containing `prepay_id`, and then attempted to manually sign it. However, the library consumes `prepay_id` internally and returns the fully signed payment object in `result.data`.

### Resolution
The logic in `src/wechat-pay/index.ts` was updated to:
1. Check if `result.data` already contains `paySign` and `package`.
2. If so, return those parameters directly to the frontend.
3. Fallback to manual signing only if a raw `prepay_id` is found.

```typescript
// Optimized response handling
if (result.data && result.data.paySign && result.data.package) {
    return {
        timeStamp: result.data.timeStamp,
        nonceStr: result.data.nonceStr,
        package: result.data.package,
        signType: result.data.signType || 'RSA',
        paySign: result.data.paySign
    };
}
```

## Security & Deployment
- **Certificate Protection**: The deployment workflow (`deploy.yml`) is configured to exclude certificates (`*.pem`) and environment files (`.env`) during `git clean` to prevent production secret loss.
- **Webhook RawBody**: Signature verification requires the exact raw binary body. This is captured using a custom `verify` function in `express.json()` middleware in `server.ts`.

## Environment Requirements
The following `.env` variables and files are mandatory on the server:
- `WX_APPID`: WeChat Mini Program AppID
- `WX_MCHID`: WeChat Merchant ID
- `WX_API_V3_KEY`: API v3 Key (32 chars)
- `WX_CERT_SERIAL_NO`: Merchant Certificate Serial Number
- `apiclient_key.pem`: Merchant Private Key
- `pub_key.pem`: WeChat Pay Public Key (Public Key Mode preferred)
