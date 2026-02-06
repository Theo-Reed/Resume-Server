export enum StatusCode {
  SUCCESS = 200,
  // Standard HTTP Status Codes (Passed from network layer)
  HTTP_FORBIDDEN = 403,
  HTTP_CONFLICT = 409,

  // Client errors (40000+)
  BAD_REQUEST = 40000,
  INVALID_PARAMS = 40001,
  
  // Auth errors (40100+)
  UNAUTHORIZED = 40101, // Missing token
  INVALID_TOKEN = 40102, // Invalid/Expired token
  USER_NOT_FOUND = 40103, // For loginByOpenid: user doesn't exist (need register)
  INVALID_CREDENTIALS = 40104, // Wrong password or phone
  
  // Permission errors (40300+)
  FORBIDDEN = 40301,
  QUOTA_EXHAUSTED = 40302,
  
  // Conflict errors (40900+)
  USER_EXISTS = 40901,
  JOB_ALREADY_SAVED = 40902,
  
  // Server errors (50000+)
  INTERNAL_ERROR = 50000,
}

export const StatusMessage: Record<number, string> = {
  [StatusCode.HTTP_FORBIDDEN]: '无权访问 (403)',
  [StatusCode.HTTP_CONFLICT]: '资源冲突 (409)',
  [StatusCode.BAD_REQUEST]: '请求参数错误',
  [StatusCode.INVALID_PARAMS]: '参数校验失败',
  [StatusCode.UNAUTHORIZED]: '未授权或登录过期',
  [StatusCode.INVALID_TOKEN]: '登录凭证无效',
  [StatusCode.USER_NOT_FOUND]: '用户不存在',
  [StatusCode.INVALID_CREDENTIALS]: '手机号或密码错误',
  [StatusCode.FORBIDDEN]: '拒绝访问',
  [StatusCode.QUOTA_EXHAUSTED]: '您的算力点数已耗尽或会员已过期，请前往会员中心充值。',
  [StatusCode.USER_EXISTS]: '该手机号已被注册',
  [StatusCode.JOB_ALREADY_SAVED]: '该职位已收藏',
  [StatusCode.INTERNAL_ERROR]: '系统繁忙，请稍后再试',
};
