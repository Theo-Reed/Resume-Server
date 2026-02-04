import { Router } from 'express';
import register from './register';
import login from './login';
import loginByOpenid from './loginByOpenid';

const router = Router();

router.use(register);
router.use(login);
router.use(loginByOpenid);

export default router;
