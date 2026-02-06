import { Request, Response } from 'express';
import { getDb } from '../../db';

// Used in: app.ts
export const systemConfig = async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const config = await db.collection('system_config').findOne({ key: 'global_settings' });
    
    if (config) {
      res.json({
          success: true,
          result: {
              isBeta: config.isBeta,
              isMaintenance: config.isMaintenance
          }
      });
    } else {
      res.json({
          success: true,
          result: {
              isBeta: false,
              isMaintenance: false
          }
      });
    }
  } catch (error) {
    console.error('system-config error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
