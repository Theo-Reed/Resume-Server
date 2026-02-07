import { Router, Request, Response } from 'express';
import multer from 'multer';
import { GenerateFromFrontendRequest, JobData } from '../../types';
import { randomUUID } from 'crypto';
import { getDb } from '../../db';
import { runBackgroundTask } from '../../taskRunner';
import { StatusCode, StatusMessage } from '../../constants/statusCodes';

const router = Router();

// Configure Multer for this specific route
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

router.post('/refine-resume', upload.single('file'), async (req: Request, res: Response) => {
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

        // --- Quota Check ---
        let consumedType = '';
        const membership = (user as any).membership || {};
        const quota = membership.pts_quota || { limit: 0, used: 0 };
        const topupBalance = membership.topup_quota || 0;
        const now = new Date();
        const isMemberActive = membership.expire_at && new Date(membership.expire_at) > now;

        if (isMemberActive && quota.used < quota.limit) {
            consumedType = 'monthly';
            await usersCol.updateOne({ _id: user._id }, { $inc: { 'membership.pts_quota.used': 1 } });
        } else if (topupBalance > 0) {
            consumedType = 'topup';
            await usersCol.updateOne({ _id: user._id }, { $inc: { 'membership.topup_quota': -1 } });
        } else {
             return res.status(StatusCode.HTTP_FORBIDDEN).json({ 
                success: false,
                code: StatusCode.QUOTA_EXHAUSTED,
                message: StatusMessage[StatusCode.QUOTA_EXHAUSTED]
             });
        }

        // 1. Extract Profile
        console.log(`[Refine] Extracting info from ${file.originalname} (${file.mimetype})...`);
        let extractedData: any;
        try {
            extractedData = await services.aiService.extractResumeInfoFromDocument(file.buffer, file.mimetype);
        } catch (extractError: any) {
            console.error(`[Refine] AI Extraction failed:`, extractError);
            
            // Only refund implementation error (System fault).
            // If it is "Invalid Content" (User fault, e.g. empty or non-resume file), DO NOT refund.
            const isUserFault = extractError.message && extractError.message.includes("无效内容");
            
            if (!isUserFault) {
                 console.log(`[Refine] System error detected, processing refund (${consumedType})...`);
                 if (consumedType === 'monthly') {
                     await usersCol.updateOne({ _id: user._id }, { $inc: { 'membership.pts_quota.used': -1 } });
                 } else if (consumedType === 'topup') {
                     await usersCol.updateOne({ _id: user._id }, { $inc: { 'membership.topup_quota': 1 } });
                 }
                 return res.status(500).json({ success: false, message: '系统繁忙，请稍后重试。' });
            } else {
                 console.log(`[Refine] User content error (Invalid Content), quota consumed.`);
                 // Return 200 with error code so frontend can parse it and show specific modal
                 return res.status(200).json({ 
                    success: false, 
                    code: StatusCode.INVALID_DOCUMENT_CONTENT, 
                    message: StatusMessage[StatusCode.INVALID_DOCUMENT_CONTENT] 
                 });
            }
        }

        // --- Identity Info Validation ---
        // 必须识别到姓名，且至少有一个联系方式 (手机、邮箱或微信)
        const hasMobile = extractedData.mobile && extractedData.mobile.length > 5;
        const hasEmail = extractedData.email && extractedData.email.includes('@');
        const hasWechat = extractedData.wechat && extractedData.wechat.length > 2;
        
        if (!extractedData.name || (!hasMobile && !hasEmail && !hasWechat)) {
            console.warn(`[Refine] Extraction failed: Missing identity info. Name: ${extractedData.name}, Contact: ${hasMobile||hasEmail||hasWechat}`);
            
            // Do NOT refund here. AI worked successfully but user data is incomplete/invalid.
            
            return res.status(StatusCode.HTTP_FORBIDDEN).json({
                success: false,
                code: StatusCode.MISSING_IDENTITY_INFO,
                message: StatusMessage[StatusCode.MISSING_IDENTITY_INFO]
            });
        }

        // 2. Map to internal UserResumeProfile
        const resume_profile: any = {
            name: extractedData.name || "",
            photo: "", 
            gender: extractedData.gender || "",
            birthday: extractedData.birthday || "",
            wechat: extractedData.wechat || "",
            email: extractedData.email || "",
            phone: extractedData.mobile || "", 
            educations: (extractedData.education || []).map((e: any) => ({
                school: e.school || "",
                degree: e.degree || "",
                major: e.major || "",
                startDate: e.startTime || "",
                endDate: e.endTime || "",
                description: ""
            })),
            workExperiences: (extractedData.experience || []).map((e: any) => ({
                company: e.company || "",
                jobTitle: e.role || "",
                businessDirection: "",
                workContent: e.description || "",
                startDate: e.startTime || "",
                endDate: e.endTime || ""
            })),
            certificates: [],
            skills: extractedData.skills || [],
            aiMessage: `Optimized from ${file.originalname}`,
            location: extractedData.city || ""
        };

        // 3. Construct Dummy Job Data for "Polishing"
        const latestJob = resume_profile.workExperiences[0];
        const targetTitle = latestJob ? (latestJob.jobTitle || "Job Seeker") : "Job Seeker";

        // --- Save to User Profile (New Logic) ---
        // 自动将提取出的信息更新到用户的简历库中，这样用户之后进入“我的资料”也能看到
        console.log(`[Refine] Auto-updating user profile for ${userAuth.phoneNumber}`);
        await usersCol.updateOne(
            { _id: user._id },
            { 
                $set: { 
                    "resume_profile.zh": resume_profile,
                    "name": resume_profile.name,
                    "gender": resume_profile.gender
                } 
            }
        );

        const job_data: JobData = {
            _id: `POLISH_${randomUUID()}`,
            title: targetTitle,
            title_chinese: targetTitle,
            title_english: targetTitle,
            team: "General",
            summary: "General Application",
            summary_chinese: ["通用投递"],
            summary_english: ["General Application"],
            salary: "Open",
            salary_english: "Open",
            createdAt: new Date().toISOString(),
            source_name: "Self-Import",
            source_name_english: "Self-Import",
            source_url: "",
            type: "Full-time",
            description: "General role requirements.",
            description_chinese: "通用岗位要求",
            description_english: "General role requirements",
            city: resume_profile.location || "Remote",
            experience: "3 years"
        };

        const requestPayload: GenerateFromFrontendRequest = {
            jobId: job_data._id,
            openid: userAuth.phoneNumber, 
            language: 'chinese',
            resume_profile,
            job_data
        };

        // 4. Create Task & Trigger Background Job
        const taskId = `RESUME_${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}_${randomUUID().slice(0, 8)}`;
        
        console.log(`[Refine] Creating task ${taskId} for ${targetTitle}`);
        
        await db.collection('generated_resumes').insertOne({
           task_id: taskId,
           jobId: job_data._id,
           jobTitle: job_data.title,
           jobTitle_cn: job_data.title_chinese,
           jobTitle_en: job_data.title_english,
           company: job_data.team,
           openid: userAuth.phoneNumber,
           phoneNumber: userAuth.phoneNumber,
           status: 'processing',
           consumedType, // 用于后台任务失败时的额度退回
           createTime: now,
           payload: requestPayload
        });

        // Trigger background task (Async)
        runBackgroundTask(taskId, requestPayload, { db }).catch(err => {
            console.error(`[Refine] Background task failed to start for ${taskId}`, err);
        });

        res.json({
            success: true,
            taskId,
            message: 'Resume generation started'
        });

    } catch (e: any) {
        console.error("Refine Resume Failed", e);
        
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
