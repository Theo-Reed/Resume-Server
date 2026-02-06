const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
      console.error('❌ Error: MONGODB_URI not found in .env');
      process.exit(1);
  }
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const dbName = process.env.MONGODB_DB_NAME;
    if (!dbName) {
        console.error('❌ Error: MONGODB_DB_NAME not found in .env');
        process.exit(1);
    }
    const db = client.db(dbName);
    
    await db.collection('member_schemes').deleteMany({});
    await db.collection('member_schemes').insertMany([
      {
        scheme_id: 1,
        name: "体验会员",
        name_chinese: "体验会员",
        name_english: "Trial Member",
        type: "trial",
        price: 500,
        original_price: 500,
        days: 3,
        points: 5,
        description_chinese: "新用户赠送 | 基础体验",
        description_english: "New user gift | Basic trial",
        description: "新用户赠送 | 基础体验",
        level: 1,
        isHidden: true
      },
      {
        scheme_id: 2,
        name: "周卡会员",
        name_chinese: "周卡会员",
        name_english: "Sprint Pass",
        type: "sprint",
        price: 990,
        original_price: 1990,
        days: 7,
        points: 10,
        description_chinese: "短期加速 | 七天冲刺",
        description_english: "Short-term boost | 7-day sprint",
        description: "短期加速 | 七天冲刺",
        level: 2,
      },
      {
        scheme_id: 3,
        name: "标准会员",
        name_chinese: "标准会员",
        name_english: "Standard Member",
        type: "standard",
        price: 1990,
        original_price: 2990,
        days: 30,
        points: 25,
        description_chinese: "职场必备 | 月度稳进",
        description_english: "Career essential | Monthly steady",
        description: "职场必备 | 月度稳进",
        level: 3,
      },
      {
        scheme_id: 4,
        name: "高级会员",
        name_chinese: "高级会员",
        name_english: "Premium Member",
        type: "ultimate",
        price: 4990,
        original_price: 9990,
        days: 30,
        points: 120,
        description_chinese: "火力全开 | 尊享特权",
        description_english: "Full speed ahead | Premium perks",
        description: "火力全开 | 尊享特权",
        level: 4,
      },
      {
        scheme_id: 5,
        name: "算力加油包",
        name_chinese: "算力加油包",
        name_english: "Points Top-up",
        type: "topup",
        price: 490,
        original_price: 990,
        days: 0,
        points: 10,
        description_chinese: "灵活补给 | 永久有效",
        description_english: "Flexible top-up | Forever valid",
        description: "灵活补给 | 永久有效",
        level: 0,
      }
    ]);
    
    // Also clear users to test new auth system
    // await db.collection('users').deleteMany({});
    
    // User Indexes for Login Wall
    console.log('Ensuring user indexes...');
    try {
      const userCollection = db.collection('users');
      const existingIndexes = await userCollection.indexes();

      const hasPhoneIdx = existingIndexes.some(idx => idx.key && idx.key.phone === 1);
      const hasOpenidsIdx = existingIndexes.some(idx => idx.key && idx.key.openids === 1);
      const hasOpenidIdx = existingIndexes.some(idx => idx.key && idx.key.openid === 1);

      if (!hasPhoneIdx) {
        await userCollection.createIndex({ phone: 1 }, { unique: true, sparse: true });
        console.log('Created index: phone_1');
      } else {
        console.log('Index phone_1 exists, skipping creation.');
      }

      if (!hasOpenidsIdx) {
        await userCollection.createIndex({ openids: 1 }, { unique: true, sparse: true });
        console.log('Created index: openids_1');
      } else {
        console.log('Index openids_1 exists, skipping creation.');
      }

      // Keep single openid field index for legacy logic support if needed
      if (!hasOpenidIdx) {
        await userCollection.createIndex({ openid: 1 });
        console.log('Created index: openid_1');
      } else {
        console.log('Index openid_1 exists, skipping creation.');
      }
    } catch (e) {
      console.error('Error ensuring user indexes:', e);
    }
    
    await db.collection('generated_resumes').deleteMany({});
    await db.collection('orders').deleteMany({});
    await db.collection('saved_search_conditions').deleteMany({});
    await db.collection('saved_jobs').deleteMany({});
    
    // 建立索引
    // 1. 订单自动清理索引： MongoDB 会根据 expireAt 字段的时间自动删除文档
    // 我们设置 expireAfterSeconds: 0，意味着在 expireAt 那个时刻删除 (通常设为 2 小时)
    try {
      const orders = db.collection('orders');
      const ordersIndexes = await orders.indexes();
      const hasExpireIdx = ordersIndexes.some(idx => idx.key && idx.key.expireAt === 1);
      const hasOrderQueryIdx = ordersIndexes.some(idx => idx.key && idx.key.openid === 1 && idx.key.scheme_id === 1 && idx.key.status === 1);

      if (!hasExpireIdx) {
        await orders.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
        console.log('Created index: orders.expireAt_1 (TTL)');
      } else {
        console.log('orders.expireAt index exists, skipping creation.');
      }

      if (!hasOrderQueryIdx) {
        await orders.createIndex({ openid: 1, scheme_id: 1, status: 1 });
        console.log('Created index: orders.openid_1_scheme_id_1_status_1');
      } else {
        console.log('orders query index exists, skipping creation.');
      }
    } catch (e) {
      console.error('Error ensuring orders indexes:', e);
    }

    // 3. 搜索条件索引
    try {
      const savedSearch = db.collection('saved_search_conditions');
      const sIndexes = await savedSearch.indexes();
      const hasSearchIdx = sIndexes.some(idx => idx.key && idx.key.phoneNumber === 1 && idx.key.tabIndex === 1);
      if (!hasSearchIdx) {
        await savedSearch.createIndex({ phoneNumber: 1, tabIndex: 1 });
        console.log('Created index: saved_search_conditions.phoneNumber_1_tabIndex_1');
      } else {
        console.log('saved_search_conditions index exists, skipping creation.');
      }
    } catch (e) {
      console.error('Error ensuring saved_search_conditions indexes:', e);
    }

    // 4. 收藏岗位唯一索引
    try {
      const savedJobs = db.collection('saved_jobs');
      const sjIndexes = await savedJobs.indexes();
      const hasSavedJobsIdx = sjIndexes.some(idx => idx.key && idx.key.phoneNumber === 1 && idx.key.jobId === 1);
      if (!hasSavedJobsIdx) {
        await savedJobs.createIndex({ phoneNumber: 1, jobId: 1 }, { unique: true });
        console.log('Created index: saved_jobs.phoneNumber_1_jobId_1 (unique)');
      } else {
        console.log('saved_jobs unique index exists, skipping creation.');
      }
    } catch (e) {
      console.error('Error ensuring saved_jobs indexes:', e);
    }

    console.log('Successfully initialized member_schemes and cleared data.');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
