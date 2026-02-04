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
    
    console.log('creating indexes for users collection...');
    // Unique index on phone
    await db.collection('users').createIndex({ phone: 1 }, { unique: true, sparse: true });
    // Index on openids array for fast lookup
    await db.collection('users').createIndex({ openids: 1 });
    // Keep openid just in case for legacy/migration, but it shouldn't be unique globally anymore if we strictly use openids array
    // However, existing users have `openid` field. 
    await db.collection('users').createIndex({ openid: 1 });

    console.log('✅ Updated Indexes');

  } catch (err) {
      console.error(err);
  } finally {
      await client.close();
  }
}

main();
