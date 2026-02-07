import { Router, Request, Response } from 'express';
import { SchemeRepository, UserRepository } from '../../repositories';

const router = Router();

/**
 * [Big Tech Architecture] Retrieve membership schemes with business level filtering.
 */
router.post('/getMemberSchemes', async (req: Request, res: Response) => {
  try {
    // 1. Data Retrieval
    const [rawSchemes, openid] = [
        await SchemeRepository.listPublicSchemes(),
        req.headers['x-openid'] as string || req.body.openid
    ];

    let memberLevel = 0;
    if (openid) {
      const user = await UserRepository.findByOpenidOrId(openid);
      memberLevel = user?.membership?.level || 0;
    }

    // 2. Business Rules Filtering
    let schemes = rawSchemes.filter((s:any) => !s.isHidden);
    
    // Safety Rule: Non-members and Trial Members cannot see Top-up options
    if (memberLevel <= 1) {
      schemes = schemes.filter((s:any) => s.scheme_id !== 5);
    }
    
    // 3. UI/UX Decoration logic
    const filler = { cn: "当前会员等级不变", en: "No change to current level", isDash: true };
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
             { cn: "更多的算力配额", en: "More Computing Quota" },
             filler
        ],
        renewal: [
            { cn: "续费后配额累加", en: "Stackable Quota" },
            { cn: "续费后时效累加", en: "Stackable Duration" },
            filler
        ],
        topupGeneral: [
            { cn: "会员专享 额度不浪费", en: "Member Exclusive" },
            { cn: "不限量叠加使用", en: "Unlimited Stacking" },
            filler
        ]
    };

    schemes.forEach((s: any) => {
        let feats: {cn:string, en:string, isDash?:boolean}[] = [];
        const sid = s.scheme_id;

        if (memberLevel <= 1) {
            if (sid === 3 || sid === 2) feats = F.standardBenefits;
            else if (sid === 4) feats = F.premiumBenefits;
        } else if (memberLevel === 2) {
             if (sid === 3) feats = F.upgradeToStandard;
             else if (sid === 4) feats = F.premiumBenefits;
             else if (sid === 2) feats = F.renewal;
             else if (sid === 5) feats = F.topupGeneral;
        } else if (memberLevel === 3) {
            if (sid === 4) feats = F.premiumBenefits;
            else if (sid === 3 || sid === 2) feats = F.renewal;
            else if (sid === 5) feats = F.topupGeneral;
        } else if (memberLevel === 4) {
            feats = (sid === 5) ? F.topupGeneral : F.renewal;
        }
        s.features = feats;
    });

    res.json({ success: true, result: schemes });
  } catch (error: any) {
    console.error('[GetSchemes] Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}); 
        }
        // Scenario 4: Premium (4)
        else if (memberLevel === 4) {
             if (sid === 2 || sid === 3 || sid === 4) feats = F.renewal;
             else if (sid === 5) feats = F.topupEmergency;
        }

        s.features_chinese = feats.map(f => f.cn);
        s.features_english = feats.map(f => f.en);
        s.features_is_dash = feats.map(f => !!f.isDash);

        // Final safety check: ensure 3 items
        while (s.features_chinese.length < 3) {
            s.features_chinese.push(filler.cn);
            s.features_english.push(filler.en);
            s.features_is_dash.push(true);
        }
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
