import { Request, Response } from 'express';
import { getDb } from '../../db';

// Used in: pages/index/index.ts
export const getSavedSearchConditions = async (req: Request, res: Response) => {
  try {
    const { tabIndex, openid } = req.body;
    const finalOpenid = req.headers['x-openid'] as string || openid;

    if (!finalOpenid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const db = getDb();

    // Logic:
    // Query 'saved_search_conditions' where openid = openid AND tabIndex = tabIndex
    // Ensure tabIndex is a number if it's being compared to numbers in DB
    const queryTabIndex = typeof tabIndex === 'string' ? parseInt(tabIndex, 10) : tabIndex;

    const conditions = await db.collection('saved_search_conditions').find({
      openid: finalOpenid,
      tabIndex: queryTabIndex
    }).toArray();
    
    res.json({
      success: true,
      result: {
        items: conditions || []
      }
    });
  } catch (error) {
    console.error('Error in getSavedSearchConditions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
