import { Router } from 'express';
import register from './register';
import login from './login';
import loginByOpenid from './loginByOpenid';

console.log('[Auth] Initializing Auth Module routes...');
const router = Router();

router.use(register);
router.use(login);
router.use(loginByOpenid);

export default router;
