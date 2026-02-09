import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getDb } from '../../db';
import { StatusCode, StatusMessage } from '../../constants/statusCodes';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and Images are allowed'));
        }
    }
});

/**
 * 解析简历文件
 * POST /api/resume/parse
 */
router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const { services } = req.app.locals;
        const userAuth = (req as any).user;
        const file = req.file;

        if (!file) {
             return res.status(400).json({ success: false, message: '请上传文件' });
        }

        if (!userAuth || !userAuth.phoneNumber) {
             return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const db = getDb();
        const usersCol = db.collection('users');
        const user = await usersCol.findOne({ phone: userAuth.phoneNumber });

        if (!user) {
             return res.status(404).json({ success: false, message: 'User not found' });
        }

        // --- Quota Check (Parsing costs 1 point) ---
        const membership = (user as any).membership || {};
        const quota = membership.pts_quota || { limit: 0, used: 0 };
        const topupBalance = membership.topup_quota || 0;
        const now = new Date();
        const isMemberActive = membership.expire_at && new Date(membership.expire_at) > now;

        if (isMemberActive && quota.used < quota.limit) {
            await usersCol.updateOne({ _id: user._id }, { $inc: { 'membership.pts_quota.used': 1 } });
        } else if (topupBalance > 0) {
            await usersCol.updateOne({ _id: user._id }, { $inc: { 'membership.topup_quota': -1 } });
        } else {
             return res.status(StatusCode.HTTP_FORBIDDEN).json({ 
                success: false,
                code: StatusCode.QUOTA_EXHAUSTED,
                message: StatusMessage[StatusCode.QUOTA_EXHAUSTED]
             });
        }

        // 1. Extract Profile
        console.log(`[Parse] User ${userAuth.phoneNumber} parsing ${file.originalname} (${file.mimetype})...`);
        const extractedData = await services.aiService.extractResumeInfoFromDocument(file.buffer, file.mimetype);
        
        console.log(`[Parse] Extraction complete for ${userAuth.phoneNumber}. Detected Name: ${extractedData.name}, Lang: ${extractedData.language}`);

        // 2. Identity Info Validation
        const hasMobile = extractedData.mobile && extractedData.mobile.length > 5;
        const hasEmail = extractedData.email && extractedData.email.includes('@');
        const hasWechat = extractedData.wechat && extractedData.wechat.length > 2;

        console.log(`[Parse] Identity check: Name=${!!extractedData.name}, Mobile=${!!hasMobile}, Email=${!!hasEmail}, Wechat=${!!hasWechat}`);
        
        if (!extractedData.name || (!hasMobile && !hasEmail && !hasWechat)) {
            console.warn(`[Parse] Failed identity validation for ${userAuth.phoneNumber}. Data:`, JSON.stringify(extractedData).substring(0, 500));
            return res.status(StatusCode.HTTP_FORBIDDEN).json({
                success: false,
                code: StatusCode.MISSING_IDENTITY_INFO,
                message: StatusMessage[StatusCode.MISSING_IDENTITY_INFO]
            });
        }

        console.log(`[Parse] Success: ${extractedData.experience?.length || 0} exp, ${extractedData.education?.length || 0} edu.`);
        
        // 提炼简历关键信息作为输出
        const keyInfo = {
            name: extractedData.name,
            contact: `${extractedData.mobile || 'N/A'} | ${extractedData.email || 'N/A'}`,
            latest_edu: extractedData.education?.[0] ? `${extractedData.education[0].school} (${extractedData.education[0].degree})` : 'N/A',
            latest_exp: extractedData.experience?.[0] ? `${extractedData.experience[0].company} - ${extractedData.experience[0].role}` : 'N/A',
            skills_count: extractedData.skills?.length || 0
        };
        console.log(`[Parse] Key Info Summary:`, JSON.stringify(keyInfo, null, 2));

        res.json({
            success: true,
            result: {
                profile: extractedData,
                language: extractedData.language || 'chinese'
            }
        });

    } catch (e: any) {
        console.error("Parse Resume Failed", e);
        let statusCode = 500;
        let message = e.message;

        if (message && message.includes("无效内容")) {
            statusCode = StatusCode.INVALID_DOCUMENT_CONTENT;
            message = StatusMessage[StatusCode.INVALID_DOCUMENT_CONTENT];
        }

        res.status(statusCode).json({ success: false, message, code: statusCode });
    }
});

export default router;
