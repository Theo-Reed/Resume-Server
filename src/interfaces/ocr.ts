import { Router, Request, Response } from 'express';
import multer from 'multer';
import { GeminiService } from '../geminiService';

const router = Router();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for high-res screenshots
});

router.post('/ocr', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未上传图片' });
        }

        const gemini: GeminiService = req.app.locals.services.gemini;
        
        const prompt = `你是一个专业的HR。请阅读这张招聘职位的截图，提取其中的关键信息，并严格以JSON格式输出。

输出格式要求（仅输出此 JSON 对象）：
{
  "title": "职位名称",
  "company": "公司名称",
  "experience": "经验要求，例如：3-5年。如果没提到，请填'不限'或保留空字符串",
  "content": "完整且详细的职位描述，包括岗位职责和任职要求。请尽量还原图中文字内容，以便后续 AI 生成简历。"
}

注意：
1. 严禁输出 JSON 以外的任何文字、解释或 Markdown 代码块标记（如 \`\`\`json ）。
2. 如果某项信息缺失，请保留为空字符串。
3. 语言应与截图中的主要语言保持一致。`;

        console.log(`[OCR] 收到图片上传: ${req.file.originalname} (${req.file.size} bytes)`);
        
        const resultText = await gemini.analyzeImage(prompt, req.file.buffer, req.file.mimetype);
        
        // 尝试解析 JSON
        let extractedData;
        try {
            // 兼容可能带 markdown 标记的输出
            const cleanedJson = resultText.replace(/```json\n?|\n?```/g, '').trim();
            extractedData = JSON.parse(cleanedJson);
        } catch (parseError) {
            console.error('JSON Parse Error from AI:', resultText);
            throw new Error('AI 返回的格式不符合 JSON 规范');
        }

        console.log(`[OCR] 解析成功: ${extractedData.title} @ ${extractedData.company}`);

        res.json({
            success: true,
            result: extractedData
        });

    } catch (error: any) {
        console.error('OCR Error:', error);
        res.status(500).json({
            success: false,
            message: '解析失败：' + (error.message || '未知错误')
        });
    }
});

export default router;
