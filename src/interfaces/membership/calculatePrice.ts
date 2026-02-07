import { Router, Request, Response } from 'express';
import { UserRepository, SchemeRepository } from '../../repositories';
import { MembershipDomainService } from '../../services/membershipService';

const router = Router();

/**
 * [Big Tech Architecture] Price calculation before order creation.
 * Mirroring the logic in MembershipDomainService.
 */
router.post('/calculatePrice', async (req: Request, res: Response) => {
  try {
    const { scheme_id } = req.body;
    const openid = req.headers['x-openid'] as string || req.body.openid;

    if (!openid) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // 1. Fetch Entities
    const [scheme, user] = await Promise.all([
        SchemeRepository.findBySchemeId(Number(scheme_id)),
        UserRepository.findByOpenidOrId(openid)
    ]);

    if (!scheme) return res.status(400).json({ success: false, message: 'Invalid Scheme' });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // 2. Domain logic: Get current level scheme for deduction calculation
    const currentLevel = user.membership?.level || 0;
    const currentScheme = await SchemeRepository.findByLevel(currentLevel);

    const { payAmount } = MembershipDomainService.calculatePrice(user, scheme, currentScheme || undefined);

    res.json({
      success: true,
      result: {
        originalPrice: scheme.price,
        finalPrice: payAmount,
        isUpgrade: payAmount < scheme.price && scheme.type !== 'topup',
        discountAmount: scheme.price - payAmount
      }
    });
  } catch (error: any) {
    console.error('[CalculatePrice] Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}); 

export default router;
