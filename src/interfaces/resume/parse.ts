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

        const membership = (user as any).membership || {};
        const level = membership.level || 0;
        const lastGenerated = (user as any).resume_profile?.last_generated ? new Date((user as any).resume_profile.last_generated).getTime() : 0;
        const now = Date.now();
        const completeness = (user as any).resume_profile?.completeness?.score || 0;
        const zhCompleteness = (user as any).resume_profile?.zh?.completeness?.score || 0;
        const enCompleteness = (user as any).resume_profile?.en?.completeness?.score || 0;
        const maxCompleteness = Math.max(completeness, zhCompleteness, enCompleteness);

        // --- Cooldown Check (Based on User Level & Completeness) ---
        // Rule: If completeness < 45, ignore cooldown (allow unlimited updates to fix bad profiles)
        // Rule: If Level < 1, 6 hours cooldown. If Level >= 1, 1 hour cooldown.
        // Rule: Updating profile does NOT consume quota.
        
        let cooldownMs = 6 * 3600 * 1000; // Default 6 hours
        if (level >= 1) {
            cooldownMs = 1 * 3600 * 1000; // Member 1 hour
        }

        if (maxCompleteness >= 45 && lastGenerated > 0 && (now - lastGenerated < cooldownMs)) {
             const remainingMinutes = Math.ceil((cooldownMs - (now - lastGenerated)) / 60000);
             // 修改冷却期返回策略：success:true, 但通过 code 提示冷却
             // 这样前端不会直接走 error 逻辑弹窗，而是可以自行判断 code == COOLDOWN_ACTIVE 并静默打印
             console.log(`[Parse] Cooldown active for ${user.phone}, ${remainingMinutes}m remaining. Skipping AI generation.`);
             return res.json({ 
                success: true, 
                code: StatusCode.COOLDOWN_ACTIVE,
                result: {
                    skipped: true,
                    message: `Cool-down active (${remainingMinutes}m)`,
                    profile: user.resume_profile // 返回旧档案，防止空数据覆盖
                }
             });
        }

        // --- Quota Check Removed for Profile Updates ---
        // Previously: Deducted 1 point. Now: Free, just time-limited.
        /*
        const quota = membership.pts_quota || { limit: 0, used: 0 };
        const topupBalance = membership.topup_quota || 0;
        const isMemberActive = membership.expire_at && new Date(membership.expire_at) > new Date();

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
        */

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
