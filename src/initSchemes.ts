import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const schemes = [
  {
    scheme_id: 1,
    name_chinese: "体验会员",
    name_english: "Trial Member",
    type: "trial",
    price: 500, // ¥5.0 (for upgrade calculation)
    original_price: 500,
    days: 3,
    points: 5,
    description_chinese: "新用户赠送 | 基础体验",
    description_english: "New user gift | Basic trial",
    level: 1,
    isHidden: true // Front-end will hide this from shop
  },
  {
    scheme_id: 2,
    name_chinese: "周卡会员",
    name_english: "Sprint Pass",
    type: "sprint",
    price: 990, // ¥9.9
    original_price: 1990,
    days: 7,
    points: 10,
    description_chinese: "短期加速 | 七天冲刺",
    description_english: "Short-term boost | 7-day sprint",
    level: 2,
  },
  {
    scheme_id: 3,
    name_chinese: "标准会员",
    name_english: "Standard Member",
    type: "standard",
    price: 1990, // ¥19.9
    original_price: 2990,
    days: 30,
    points: 25,
    description_chinese: "职场必备 | 月度稳进",
    description_english: "Career essential | Monthly steady",
    level: 3,
  },
  {
    scheme_id: 4,
    name_chinese: "高级会员",
    name_english: "Premium Member",
    type: "ultimate",
    price: 4990, // ¥49.9
    original_price: 9990,
    days: 30,
    points: 120,
    description_chinese: "火力全开 | 尊享特权",
    description_english: "Full speed ahead | Premium perks",
    level: 4,
  },
  {
    scheme_id: 5,
    name_chinese: "算力加油包",
    name_english: "Points Top-up",
    type: "topup",
    price: 490, // ¥4.9
    original_price: 990,
    days: 0,
    points: 10,
    description_chinese: "灵活补给 | 永久有效",
    description_english: "Flexible top-up | Forever valid",
    level: 0,
  }
];

async function initSchemes() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/miniprogram_db';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB...');
    const db = client.db();
    const collection = db.collection('member_schemes');

    // Clear existing
    await collection.deleteMany({});
    
    // Insert new
    await collection.insertMany(schemes);
    
    console.log('Schemes initialized successfully.');
    
    // verify
    const result = await collection.find().toArray();
    console.log('Current schemes:', result);

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.close();
  }
}

initSchemes();
