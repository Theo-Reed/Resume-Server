import { Router, Request, Response } from 'express';

const router = Router();

// Used in: pages/index/index.ts
router.post('/deleteSearchCondition', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;

    // Logic:
    // Delete from 'saved_search_conditions' where _id = id
    
    res.json({
      success: true,
      result: { success: true }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
