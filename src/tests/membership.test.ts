import { MembershipDomainService } from '../services/membershipService';
import { IUser, IScheme } from '../repositories';
import { ObjectId } from 'mongodb';

describe('MembershipDomainService - calculateNewState (Benefit Fulfillment)', () => {
    const now = new Date('2026-02-07T12:00:00Z');

    const mockUser = (level: number, expireAt: Date | null): IUser => ({
        _id: new ObjectId(),
        openid: 'test_user',
        membership: {
            level,
            expire_at: expireAt || undefined,
            name: 'Standard',
            type: 'standard'
        }
    });

    const mockScheme = (id: number, level: number, type: string, days: number, points: number): IScheme => ({
        scheme_id: id,
        level: level,
        type: type,
        days: days,
        points: points,
        price: 100,
        name: 'Test Scheme',
        name_chinese: '测试方案'
    });

    test('Rule 1: New subscription for a non-member should start from now', () => {
        const user = mockUser(0, null);
        const scheme = mockScheme(3, 3, 'standard', 30, 100);
        
        const result = MembershipDomainService.calculateNewState(user, scheme, now);
        
        expect(result.membershipData['membership.level']).toBe(3);
        expect(result.membershipData['membership.expire_at']).toEqual(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
        expect(result.pointsToAdd).toBe(100);
    });

    test('Rule 2: Renewal of the SAME level should extend existing expiry', () => {
        const futureExpiry = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days left
        const user = mockUser(3, futureExpiry);
        const scheme = mockScheme(3, 3, 'standard', 30, 100);
        
        const result = MembershipDomainService.calculateNewState(user, scheme, now);
        
        const expectedTime = futureExpiry.getTime() + 30 * 24 * 60 * 60 * 1000;
        expect(result.membershipData['membership.expire_at']).toEqual(new Date(expectedTime));
    });

    test('Rule 3: Upgrade to a higher level should restart the clock from now', () => {
        const user = mockUser(2, new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000));
        const scheme = mockScheme(4, 4, 'premium', 30, 500);
        
        const result = MembershipDomainService.calculateNewState(user, scheme, now);
        
        expect(result.membershipData['membership.level']).toBe(4);
        expect(result.membershipData['membership.expire_at']).toEqual(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
    });

    test('Rule 4: Top-up should add points but NOT change the membership level', () => {
        const user = mockUser(3, new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000));
        const scheme = mockScheme(5, 0, 'topup', 0, 50); // Points only
        
        const result = MembershipDomainService.calculateNewState(user, scheme, now);
        
        expect(result.membershipData['membership.level']).toBe(3); // Still Level 3
        expect(result.pointsToAdd).toBe(50);
        expect(result.membershipData['membership.expire_at']).toBeUndefined(); // Should not touch expiry if days=0
    });
});

describe('MembershipDomainService - calculatePrice (Pricing Engine)', () => {
    test('Upgrade deduction should apply correctly', () => {
        const user = {
            _id: new ObjectId(),
            openid: 'user1',
            membership: { level: 2, expire_at: new Date(Date.now() + 86400000) } // Active Level 2
        } as any;
        
        const targetScheme = { level: 3, price: 10000, type: 'standard' } as any; // Target Level 3
        const currentScheme = { level: 2, price: 3000 } as any; // Current worth 3000
        
        const { payAmount, orderType } = MembershipDomainService.calculatePrice(user, targetScheme, currentScheme);
        
        expect(payAmount).toBe(7000); // 10000 - 3000
        expect(orderType).toBe('upgrade');
    });

    test('Price should not go below 1 cent', () => {
        const user = {
            _id: new ObjectId(),
            openid: 'user1',
            membership: { level: 3, expire_at: new Date(Date.now() + 86400000) }
        } as any;
        
        const targetScheme = { level: 4, price: 50, type: 'premium' } as any;
        const currentScheme = { level: 3, price: 100 } as any; // Current worth more than target
        
        const { payAmount } = MembershipDomainService.calculatePrice(user, targetScheme, currentScheme);
        
        expect(payAmount).toBe(1); // Minimum floor
    });
});
