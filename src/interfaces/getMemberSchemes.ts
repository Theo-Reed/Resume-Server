import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// Used in: pages/me/index.ts
router.post('/getMemberSchemes', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    
    // 1. Get raw schemes
    let schemes = await db.collection('member_schemes')
      .find({ type: { $ne: 'gift' } }) // 过滤掉新用户赠送方案
      .toArray();

    // 2. Get User Context (Member Level)
    const openid = req.headers['x-openid'] as string || req.body.openid;
    let memberLevel = 0;
    let userScheme = null;
    if (openid) {
      const user = await db.collection('users').findOne({ openid });
      if (user && user.membership) {
        memberLevel = user.membership.level || 0;
      }
      
      // Fetch user's current scheme details specifically (even if hidden/gift)
      if (memberLevel > 0) {
        userScheme = await db.collection('member_schemes').findOne({ scheme_id: memberLevel });
      }
    }

    // 3. Filter Logic
    // Remove hidden schemes
    schemes = schemes.filter((s:any) => !s.isHidden);
    
    // Rule: Non-members (0) and Trial Members (1) cannot see Top-up (5)
    if (memberLevel <= 1) {
      schemes = schemes.filter((s:any) => s.scheme_id !== 5);
    }
    
    // 4. Assign Dynamic Features based on Level
    // IDs: 2=Sprint, 3=Standard, 4=Premium, 5=Topup
    // Level: 0=Non, 1=Trial, 2=Sprint, 3=Standard, 4=Premium
    
    // Feature Sets (Bilingual)
    const F = {
        standardBenefits: [
            { cn: "全场景AI生成中英简历", en: "AI Resume (CN/EN)" },
            { cn: "高薪精选岗位解锁", en: "Unlock High-Paying Jobs" },
            { cn: "AI岗位信息提炼+智能翻译", en: "AI Summary + Auto-Translate" }
        ],
        premiumBenefits: [
            { cn: "享受所有会员特权", en: "All Member Privileges" },
            { cn: "享受最高规格的算力支持通道", en: "Priority Computing Channel" },
            { cn: "配额用完后依然能继续使用", en: "Unlimited Basic Usage" }
        ],
        upgradeToStandard: [
             { cn: "更长的会员时效", en: "Longer Validity" },
             { cn: "更多的算力配额", en: "More Computing Quota" }
        ],
        renewal: [
            { cn: "续费后配额累加", en: "Stackable Quota" },
            { cn: "续费后时效累加", en: "Stackable Duration" }
        ],
        topupGeneral: [
            { cn: "会员专享 额度不浪费", en: "Member Exclusive" },
            { cn: "不限量叠加使用", en: "Unlimited Stacking" }
        ],
        topupEmergency: [
            { cn: "即刻恢复快速简历生成", en: "Restore Fast Generation" },
            { cn: "即刻恢复高级算力模型", en: "Restore Advanced Model" }
        ]
    };

    schemes.forEach((s: any) => {
        let feats: {cn:string, en:string}[] = [];
        const sid = s.scheme_id;

        // Scenario 1: Non-Member (0) & Trial (1)
        if (memberLevel <= 1) {
            if (sid === 3 || sid === 2) feats = F.standardBenefits;
            else if (sid === 4) feats = F.premiumBenefits;
        }
        // Scenario 2: Sprint (2)
        else if (memberLevel === 2) {
             if (sid === 3) feats = F.upgradeToStandard;
             else if (sid === 4) feats = F.premiumBenefits;
             else if (sid === 2) feats = F.renewal;
             else if (sid === 5) feats = F.topupGeneral;
        }
        // Scenario 3: Standard (3)
        else if (memberLevel === 3) {
            if (sid === 4) feats = F.premiumBenefits;
            else if (sid === 3 || sid === 2) feats = F.renewal;
            else if (sid === 5) feats = F.topupGeneral;
        }
        // Scenario 4: Premium (4)
        else if (memberLevel === 4) {
             if (sid === 2 || sid === 3 || sid === 4) feats = F.renewal;
             else if (sid === 5) feats = F.topupEmergency;
        }

        s.features_chinese = feats.map(f => f.cn);
        s.features_english = feats.map(f => f.en);
    });

    // 5. Sort Logic
    const getSortOrder = (level: number) => {
       // IDs: 2=Sprint, 3=Standard, 4=Premium, 5=Topup
       switch (level) {
          case 0: // Non-member
              return [3, 4, 2]; // Standard, Premium, Sprint
          case 1: // Trial
              return [3, 4, 2, 5]; // Standard, Premium, Sprint, Topup
          case 3: // Standard
              return [4, 5, 3, 2]; // Premium, Topup, Standard, Sprint
          case 4: // Premium
              return [5, 4, 3, 2]; // Topup, Premium, Standard, Sprint
          default: 
              return [3, 4, 5, 2];
       }
    };

    const preferredOrder = getSortOrder(memberLevel);
    
    schemes.sort((a, b) => {
        const idxA = preferredOrder.indexOf(a.scheme_id);
        const idxB = preferredOrder.indexOf(b.scheme_id);
        const valA = idxA === -1 ? 999 : idxA;
        const valB = idxB === -1 ? 999 : idxB;
        return valA - valB;
    });

    res.json({
      success: true,
      result: {
        success: true,
        schemes: schemes,
        userScheme: userScheme // Return current scheme details
      }
    });
  } catch (error) {
    console.error('getMemberSchemes error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
