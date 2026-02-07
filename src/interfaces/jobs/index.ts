import { Router } from 'express';
import getPublicJobList from './getPublicJobList';
import getFeaturedJobList from './getFeaturedJobList';
import getJobDetail from './getJobDetail';
import saveJob from './saveJob';
import unsaveJob from './unsaveJob';
import checkJobSaved from './checkJobSaved';
import getSavedJobs from './getSavedJobs';
import batchSaveJobs from './batchSaveJobs';
import saveCustomJob from './saveCustomJob';
import parseJobScreenshot from './parse';

const router = Router();

router.use(getPublicJobList);
router.use(getFeaturedJobList);
router.use(getJobDetail);
router.use(saveJob);
router.use(unsaveJob);
router.use(checkJobSaved);
router.use(getSavedJobs);
router.use(batchSaveJobs);
router.use(saveCustomJob);
router.use(parseJobScreenshot);

export default router;
