import { Router, Request, Response } from 'express';
import multer from 'multer';
import { join, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import sharp from 'sharp';

const router = Router();

// Configure storage for uploads
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

// We use memory storage because we want to process the image with sharp before saving
const storage = multer.memoryStorage();

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Increase to 10MB to allow large original photos
});

/**
 * Upload and compress a file
 * POST /api/upload
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `thumb-${uniqueSuffix}.webp`;
    const outputPath = join(UPLOAD_DIR, filename);

    // Process with sharp
    await sharp(req.file.buffer)
      .resize(800, 800, { // Resize to max 800x800
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 }) // Convert to WebP with quality 80
      .toFile(outputPath);

    const imageUrl = `/public/uploads/${filename}`;

    res.json({
      success: true,
      fileID: imageUrl,
      url: imageUrl
    });
  } catch (error) {
    console.error('Upload and compression error:', error);
    res.status(500).json({ success: false, message: 'Internal server error during image processing' });
  }
});

export default router;