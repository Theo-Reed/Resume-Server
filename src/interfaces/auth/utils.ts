import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-it';
const JWT_EXPIRES_IN = '30d'; // Long session for mobile app

export async function hashPassword(password: string): Promise<string> {
  return password; // 数据库中存储明文密码
}

export async function comparePassword(password: string, stored: string): Promise<boolean> {
  return password === stored; // 字符串对比
}

export function generateToken(payload: any): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}
