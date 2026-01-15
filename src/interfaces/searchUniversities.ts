import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

/**
 * Search universities with sorting logic
 * POST /api/searchUniversities
 */
router.post('/searchUniversities', async (req: Request, res: Response) => {
  try {
    const { keyword } = req.body;

    if (!keyword || keyword.length < 1) {
      return res.json({ success: true, result: { data: [] } });
    }

    const db = getDb();
    const col = db.collection('universities');

    // Search for keyword in chinese_name or english_name (case-insensitive)
    const regex = new RegExp(keyword, 'i');
    const candidates = await col.find({
      $or: [
        { chinese_name: regex },
        { english_name: regex }
      ]
    }).limit(100).toArray();

    // Sorting logic:
    // 1. Exact match (Chinese or English)
    // 2. Starts with keyword
    // 3. Keyword position (earlier is better)
    // 4. String length (shorter is better)
    
    const sorted = candidates.sort((a: any, b: any) => {
      const kw = keyword.toLowerCase();
      const aCN = (a.chinese_name || '').toLowerCase();
      const aEN = (a.english_name || '').toLowerCase();
      const bCN = (b.chinese_name || '').toLowerCase();
      const bEN = (b.english_name || '').toLowerCase();

      // 1. Exact matches
      const aExact = aCN === kw || aEN === kw;
      const bExact = bCN === kw || bEN === kw;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // 2. Starts with
      const aStarts = aCN.startsWith(kw) || aEN.startsWith(kw);
      const bStarts = bCN.startsWith(kw) || bEN.startsWith(kw);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // 3. Position (earliest of CN or EN)
      const getMinPos = (cn: string, en: string) => {
        const pCN = cn.indexOf(kw);
        const pEN = en.indexOf(kw);
        if (pCN === -1) return pEN;
        if (pEN === -1) return pCN;
        return Math.min(pCN, pEN);
      };
      
      const aPos = getMinPos(aCN, aEN);
      const bPos = getMinPos(bCN, bEN);
      if (aPos !== bPos) return aPos - bPos;

      // 4. Length
      const aLen = Math.min(aCN.length || 999, aEN.length || 999);
      const bLen = Math.min(bCN.length || 999, bEN.length || 999);
      return aLen - bLen;
    });

    res.json({
      success: true,
      result: {
        data: sorted.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('searchUniversities error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;