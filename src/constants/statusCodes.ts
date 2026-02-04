export enum StatusCode {
  SUCCESS = 0,
  
  // Client errors (40000+)
  BAD_REQUEST = 40000,
  INVALID_PARAMS = 40001,
  
  // Auth errors (40100+)
  UNAUTHORIZED = 40101, // Missing token
  INVALID_TOKEN = 40102, // Invalid/Expired token
  USER_NOT_FOUND = 40103, // For loginByOpenid: user doesn't exist (need register)
  
  // Permission errors (40300+)
  FORBIDDEN = 40301,
  
  // Conflict errors (40900+)
  USER_EXISTS = 40901,
  
  // Server errors (50000+)
  INTERNAL_ERROR = 50000,
}

export const StatusMessage: Record<StatusCode, string> = {
  [StatusCode.SUCCESS]: 'Success',
  [StatusCode.BAD_REQUEST]: 'Bad Request',
  [StatusCode.INVALID_PARAMS]: 'Invalid Parameters',
  [StatusCode.UNAUTHORIZED]: 'Unauthorized',
  [StatusCode.INVALID_TOKEN]: 'Invalid or Expired Token',
  [StatusCode.USER_NOT_FOUND]: 'User Not Found',
  [StatusCode.FORBIDDEN]: 'Forbidden',
  [StatusCode.USER_EXISTS]: 'User Already Exists',
  [StatusCode.INTERNAL_ERROR]: 'Internal Server Error',
};
