import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// Used in: app.ts
router.post('/system-config', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const config = await db.collection('system_config').findOne({ key: 'global_settings' });
    
    if (config) {
      res.json({
          success: true,
          data: {
              isBeta: config.isBeta,
              isMaintenance: config.isMaintenance
          }
      });
    } else {
      res.json({
          success: true,
          data: {
              isBeta: false,
              isMaintenance: false
          }
      });
    }
  } catch (error) {
    console.error('system-config error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
