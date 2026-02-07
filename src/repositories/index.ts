import { getDb } from '../db';
import { ObjectId } from 'mongodb';

// --- Types ---
export interface IOrder {
    _id: ObjectId;
    userId?: ObjectId;
    openid: string;
    scheme_id: number;
    status: 'pending' | 'paid' | 'completed' | 'failed' | 'cancelled';
    paidAt?: Date;
    activated?: boolean;
    [key: string]: any;
}

export interface IUser {
    _id: ObjectId;
    openid: string;
    membership?: {
        level: number;
        expire_at?: Date;
        name?: string;
        type?: string;
        [key: string]: any;
    };
    [key: string]: any;
}

export interface IScheme {
    scheme_id: number;
    level: number;
    type: string; // 'sprint', 'standard', 'topup'
    days?: number;
    duration_days?: number;
    points?: number;
    price: number;
    name: string;
    name_chinese?: string;
    [key: string]: any;
}

// --- Repositories ---

export class OrderRepository {
    private static get col() { return getDb().collection('orders'); }

    /**
     * Find an order by ID
     */
    static async findById(orderId: string | ObjectId): Promise<IOrder | null> {
        return await this.col.findOne({ _id: new ObjectId(orderId) }) as unknown as IOrder;
    }

    /**
     * CAS (Compare-And-Swap) State Transition
     * Transitions an order from 'pending' to 'paid' atomically.
     * @returns The original order document if verify/update succeeded, null otherwise.
     */
    static async acquirePaidLock(orderId: string | ObjectId): Promise<IOrder | null> {
        const result = await this.col.findOneAndUpdate(
            { 
                _id: new ObjectId(orderId), 
                status: 'pending' 
            },
            { 
                $set: { status: 'paid', paidAt: new Date(), activated: true },
                $unset: { expireAt: "" } 
            },
            { returnDocument: 'after' } // We want the state AFTER update
        );
        
        // Handle driver version differences (v4+ vs v6+)
        const doc = (result && (result as any).value !== undefined) ? (result as any).value : result;
        return doc as unknown as IOrder;
    }

    static async markAsFailed(orderId: string | ObjectId, reason: string) {
        return await this.col.updateOne(
            { _id: new ObjectId(orderId) },
            { $set: { status: 'failed', failureReason: reason } }
        );
    }
}

export class UserRepository {
    private static get col() { return getDb().collection('users'); }

    static async findByOpenidOrId(openid: string, userId?: ObjectId): Promise<IUser | null> {
        const query = userId ? { _id: userId } : { $or: [{ openid }, { openids: openid }] };
        return await this.col.findOne(query) as unknown as IUser;
    }

    static async updateMembership(userId: ObjectId, updates: any) {
        return await this.col.updateOne({ _id: userId }, updates);
    }
}

export class SchemeRepository {
    private static get col() { return getDb().collection('member_schemes'); }

    static async findBySchemeId(schemeId: number): Promise<IScheme | null> {
        return await this.col.findOne({ scheme_id: schemeId }) as unknown as IScheme;
    }

    static async findByLevel(level: number): Promise<IScheme | null> {
        return await this.col.findOne({ level: level, type: { $ne: 'topup' } }) as unknown as IScheme;
    }

    static async listPublicSchemes(): Promise<IScheme[]> {
        return await this.col.find({ type: { $ne: 'gift' } }).toArray() as unknown as IScheme[];
    }

    static async findPendingOrder(query: any): Promise<IOrder | null> {
        return await this.col.findOne({ ...query, status: 'pending' }) as unknown as IOrder;
    }

    static async create(order: IOrder): Promise<string> {
        await this.col.insertOne(order);
        return order._id.toString();
    }
}
