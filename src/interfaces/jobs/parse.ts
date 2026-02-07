import { Router, Request, Response } from 'express';
import multer from 'multer';
import { StatusCode } from '../../constants/statusCodes';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only Image files are allowed'));
        }
    }
});

router.post('/parse-job-screenshot', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const { services } = req.app.locals;
        const file = req.file;

        if (!file) {
             return res.status(400).json({ success: false, message: '请上传图片' });
        }

        console.log(`[JobParse] Parsing job info from ${file.originalname}...`);
        const result = await services.aiService.extractJobInfoFromScreenshot(file.buffer, file.mimetype);

        res.json({
            success: true,
            result
        });

    } catch (e: any) {
        console.error("Parse Job Screenshot Failed", e);
        res.status(500).json({ 
            success: false, 
            message: e.message || '系统繁忙',
            code: StatusCode.INTERNAL_ERROR
        });
    }
});

export default router;
