import { Router, Request, Response } from 'express';
import { getDb } from '../../db';
import { hashPassword, generateToken } from './utils';
import { ensureUser } from '../../userUtils'; // We might need to refactor this eventually

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, password, openid } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ success: false, message: 'Phone number and password are required' });
    }

    const db = getDb();
    const usersCol = db.collection('users');

    // 1. Check if phone is already registered
    const existingUser = await usersCol.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Phone number already registered' });
    }

    // 2. Hash password
    const hashedPassword = await hashPassword(password);

    // 3. Prepare user data
    // If openid is provided, we use it to initialize some defaults or just start clean?
    // User wants "Register new user".
    // We should check if this OpenID is already bound to someone else to be safe, 
    // but strictly strictly speaking, a new registration implies a NEW entity.
    // However, if the OpenID is bound to User A, and we register User B with this OpenID,
    // we should steal it?
    // YES. Exclusive binding.

    // Remove openid from any other user
    if (openid) {
      await usersCol.updateMany(
        { openids: openid }, 
        { $pull: { openids: openid } as any } // Cast to any to avoid complex TS typing for now
      );
      // Legacy support: clear single 'openid' field if it matches
      await usersCol.updateMany(
        { openid: openid }, 
        { $unset: { openid: "" } }
      );
    }

    const newUser = {
      phoneNumber,
      password: hashedPassword,
      openids: openid ? [openid] : [],
      createdAt: new Date(),
      updatedAt: new Date(),
      // Add default profile structure if needed
      profile: {}, 
      memberSchemes: []
    };

    const result = await usersCol.insertOne(newUser);
    
    // 4. Generate Token
    const token = generateToken({ userId: result.insertedId.toString(), phoneNumber });

    res.json({
      success: true,
      data: {
        token,
        user: {
          _id: result.insertedId,
          phoneNumber,
          openids: newUser.openids
        }
      }
    });

  } catch (error) {
    console.error('[Auth] Register error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
