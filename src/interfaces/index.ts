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

// Mount Auth routes first (no middleware interference)
apiRouter.use('/auth', auth);

// 1. 影子账号/账号合并重定向中间件
// 除了初始化和绑定手机号的接口外，所有业务接口自动映射到“主 OpenID”
apiRouter.use(async (req, res, next) => {
  const skipList = ['/initUser', '/login', '/getPhoneNumber', '/auth'];
  if (skipList.some(path => req.path.includes(path))) {
    return next();
  }

  const openid = (req.headers['x-openid'] as string) || req.body.openid;
  if (openid) {
    const effectiveOpenid = await getEffectiveOpenid(openid);
    if (effectiveOpenid !== openid) {
      // 抹平差异：后续所有业务逻辑看到的都是主账号 ID
      req.headers['x-openid'] = effectiveOpenid;
      if (req.body.openid) req.body.openid = effectiveOpenid;
    }
  }
  next();
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
