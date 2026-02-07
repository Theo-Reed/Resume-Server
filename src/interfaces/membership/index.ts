import { Router } from 'express';
import getMemberSchemes from './getMemberSchemes';
import checkMemberStatus from './checkMemberStatus';
import activateMembership from './activateMembership';
import createOrder from './createOrder';
import calculatePrice from './calculatePrice';
import applyInviteCode from './applyInviteCode';
import generateInviteCode from './generateInviteCode';
import updateOrderStatus from './updateOrderStatus';
import checkOrderStatus from './checkOrderStatus';
import payCallback from './payCallback';

const router = Router();

router.use(getMemberSchemes);
router.use(checkMemberStatus);
router.use(activateMembership);
router.use(createOrder);
router.use(calculatePrice);
router.use(applyInviteCode);
router.use(generateInviteCode);
router.use(updateOrderStatus);
router.use(checkOrderStatus);
router.use(payCallback);

export default router;
