const { MongoClient } = require('mongodb');

async function main() {
  const uri = 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('miniprogram_db');
    
    await db.collection('member_schemes').deleteMany({});
    await db.collection('member_schemes').insertMany([
      { scheme_id: 1, displayName: '试用会员', price: 9.9, quota: 1, type: 'trial' },
      { scheme_id: 2, displayName: '基础会员', price: 19.9, quota: 10, type: 'basic' },
      { scheme_id: 3, displayName: '高级会员', price: 89.9, quota: 100, type: 'pro' }
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
