import { Router } from 'express';
import register from './register';
import login from './login';
import loginByOpenid from './loginByOpenid';

const router = Router();

// 彻底扁平化：不在这里指定路径，由子模块内部定义 /auth/...
router.use(register);
router.use(login);
router.use(loginByOpenid);

export default router;
