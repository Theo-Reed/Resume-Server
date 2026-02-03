const { MongoClient } = require('mongodb');

async function main() {
  const uri = 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('miniprogram_db');
    
    await db.collection('member_schemes').deleteMany({});
    await db.collection('member_schemes').insertMany([
      { scheme_id: 1, name: '试用会员', name_chinese: '试用会员', price: 990, quota: 1, type: 'trial', level: 1 },
      { scheme_id: 2, name: '冲刺卡', name_chinese: '冲刺卡', price: 1990, quota: 5, type: 'sprint', level: 2 },
      { scheme_id: 3, name: '标准会员', name_chinese: '标准会员', price: 8990, quota: 100, type: 'standard', level: 3 }
    ]);
    
    // Also clear users to test new initUser
    await db.collection('users').deleteMany({});
    await db.collection('users').createIndex({ openid: 1 }, { unique: true });
    
    await db.collection('resumes').deleteMany({});
    await db.collection('orders').deleteMany({});
    await db.collection('search_conditions').deleteMany({});
    await db.collection('saved_jobs').deleteMany({});
    
    console.log('Successfully initialized member_schemes and cleared users.');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
