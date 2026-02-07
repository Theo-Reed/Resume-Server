import { Router } from 'express';
import getGeneratedResumes from './getGeneratedResumes';
import deleteGeneratedResume from './deleteGeneratedResume';
import retryGenerateResume from './retryGenerateResume';
import restoreResume from './restoreResume';
import generate from './generate';
import refineResume from './refine';

const router = Router();

router.use(getGeneratedResumes);
router.use(deleteGeneratedResume);
router.use(retryGenerateResume);
router.use(restoreResume);
router.use(generate);
router.use(refineResume);

export default router;
