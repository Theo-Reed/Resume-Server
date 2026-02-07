import { Router } from 'express';
import { systemConfig } from './systemConfig';
import { checkContentSafety } from '../../utils/contentGuard';
import { StatusCode, StatusMessage } from '../../constants/statusCodes';

const router = Router();

router.post('/system-config', systemConfig);

router.post('/check-content', (req, res) => {
    const { content } = req.body;
    
    if (Array.isArray(content)) {
        for (const item of content) {
            const result = checkContentSafety(item);
            if (!result.safe) {
                return res.json({
                    code: StatusCode.INTERNAL_ERROR,
                    message: result.reason || '内容不合规'
                });
            }
        }
    } else if (typeof content === 'string') {
        const result = checkContentSafety(content);
        if (!result.safe) {
            return res.json({
                code: StatusCode.INTERNAL_ERROR,
                message: result.reason || '内容不合规'
            });
        }
    }

    res.json({
        code: StatusCode.SUCCESS,
        message: 'Success'
    });
});

export default router;
