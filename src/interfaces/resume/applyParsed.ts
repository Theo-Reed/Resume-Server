import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getDb } from '../../db';
import { StatusCode } from '../../constants/statusCodes';
import { evaluateResumeCompleteness } from '../../userUtils';

const router = Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * 解析并直接应用到用户资料 (Onboarding 流程专用)
 * POST /api/resume/apply-parsed
 */
router.post('/apply-parsed', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const { services } = req.app.locals;
        const file = req.file;
        const phoneNumber = (req as any).user?.phoneNumber;

        if (!file || !phoneNumber) {
            return res.status(401).json({ success: false, message: 'Unauthorized or missing file' });
        }

        const db = getDb();
        const usersCol = db.collection('users');
        const user = await usersCol.findOne({ phone: phoneNumber });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // --- 1. 冷却期检查 (Cooldown) ---
        const membership = (user as any).membership || {};
        const level = membership.level || 0;
        const lastParseAt = membership.last_resume_parse_at ? new Date(membership.last_resume_parse_at).getTime() : 0;
        const now = Date.now();

        let cooldownMs = 24 * 3600 * 1000;
        if (level === 1) cooldownMs = 12 * 3600 * 1000;
        else if (level >= 2 && level <= 3) cooldownMs = 4 * 3600 * 1000;
        else if (level >= 4) cooldownMs = 0;

        if (now - lastParseAt < cooldownMs) {
            return res.status(403).json({ 
                success: false, 
                message: 'Feature in cooldown',
                code: StatusCode.COOLDOWN_ACTIVE 
            });
        }

        // --- 2. 额度检查 (Cost 1 point) ---
        const quota = membership.pts_quota || { limit: 0, used: 0 };
        const topupBalance = membership.topup_quota || 0;
        if ((quota.limit - quota.used) <= 0 && topupBalance <= 0) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient quota',
                code: StatusCode.QUOTA_EXHAUSTED
            });
        }

        // --- 3. 调用 AI 解析 ---
        const { profile: extracted, language } = await services.resumeAIService.extractProfileFromExperience(file.buffer, file.mimetype);

        if (!extracted || (!extracted.name && !extracted.experience?.length)) {
            return res.status(400).json({
                success: false,
                message: 'Failed to extract useful info',
                code: StatusCode.INVALID_DOCUMENT_CONTENT
            });
        }

        // --- 4. 映射到内部结构 ---
        const langKey = language === 'english' ? 'en' : 'zh';
        
        const mappedEducations = (extracted.education || []).map((e: any) => ({
            school: e.school || "",
            degree: e.degree || "",
            major: e.major || "",
            startDate: e.startTime || "",
            endDate: e.endTime || ""
        }));

        const mappedExperiences = (extracted.experience || []).map((e: any) => ({
            company: e.company || "",
            jobTitle: e.role || "",
            workContent: e.description || "",
            startDate: e.startTime || "",
            endDate: e.endTime || ""
        }));

        // 构造更新对象
        const updateFields: any = {
            [`resume_profile.${langKey}.educations`]: mappedEducations,
            [`resume_profile.${langKey}.workExperiences`]: mappedExperiences,
            [`resume_profile.${langKey}.name`]: extracted.name || "",
            'membership.last_resume_parse_at': new Date(),
        };

        if (!user.name && extracted.name) {
            updateFields.name = extracted.name;
        }

        // --- 5. 扣除额度 ---
        if (quota.limit > quota.used) {
            updateFields['membership.pts_quota.used'] = quota.used + 1;
        } else {
            updateFields['membership.topup_quota'] = topupBalance - 1;
        }

        // --- 6. 应用更新 ---
        await usersCol.updateOne({ _id: user._id }, { $set: updateFields });

        // --- 7. 重新计算完成度并返回完整用户对象 ---
        const updatedUser = await usersCol.findOne({ _id: user._id }) as any;
        const completenessUpdates: any = {};
        if (updatedUser.resume_profile) {
            completenessUpdates['resume_profile.zh.completeness'] = evaluateResumeCompleteness(updatedUser.resume_profile.zh || {}, 'zh');
            completenessUpdates['resume_profile.en.completeness'] = evaluateResumeCompleteness(updatedUser.resume_profile.en || {}, 'en');
        }
        await usersCol.updateOne({ _id: user._id }, { $set: completenessUpdates });

        const finalUser = await usersCol.findOne({ _id: user._id });

        res.json({
            success: true,
            result: {
                user: finalUser
            }
        });

    } catch (e: any) {
        console.error("Apply Parsed Failed", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

export default router;

export default router;
