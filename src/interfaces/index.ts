import { Router } from 'express';
import { getEffectiveOpenid } from '../userUtils';

// Modules
import auth from './auth'; // New Auth Module
import resume from './resume';
import user from './user';
import search from './search';
import membership from './membership';
import jobs from './jobs';
import system from './system';

const router = Router();

// Debug middleware to see what's hitting the interface router
router.use((req, res, next) => {
  console.log(`[Interface Router] ${req.method} ${req.url}`);
  next();
});

// Root level health check
router.get('/api/ping', (req, res) => res.send('pong'));

const apiRouter = Router();

// 1. 无需鉴权的公共模块挂载 (扁平模式，由子模块内部声明 /auth 路径)
apiRouter.use(auth);

// 2. JWT 验证与身份映射中间件
apiRouter.use(async (req, res, next) => {
  const skipList = [
    '/initUser', 
    '/login', 
    '/getPhoneNumber', 
    '/auth', 
    '/system-config',
    '/getPublicJobList',      // 允许未登录查看岗位列表
    '/getFeaturedJobList'     // 允许未登录查看精选岗位列表（但点击查看详情可能需要登录）
  ];
  if (skipList.some(path => req.path.includes(path))) {
    return next();
  }

  // 从 Header 获取 Token: Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const { verifyToken } = require('./auth/utils');
    const decoded = verifyToken(token);
    
    // 将手机号存储在 req.user 中，作为业务逻辑中的唯一身份标识
    // 这样做之后，业务接口直接取 req.user.phoneNumber 即可
    (req as any).user = {
      phoneNumber: decoded.phoneNumber,
      userId: decoded.userId
    };

    next();
  } catch (error) {
    console.error('[JWT Middleware] Invalid token');
    return res.status(403).json({ success: false, message: 'Invalid or expired token' });
  }
});

// Modular Registration
apiRouter.use(resume);
apiRouter.use(user);
apiRouter.use(search);
apiRouter.use(membership);
apiRouter.use(jobs);
apiRouter.use(system);

// Mount the apiRouter at /api
router.use('/api', apiRouter);

export default router;
