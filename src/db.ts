import { MongoClient, Db } from 'mongodb';

const url = 'mongodb://localhost:27017';
const dbName = 'miniprogram_db';

let db: Db | null = null;
let client: MongoClient | null = null;

export async function connectToLocalMongo(): Promise<Db> {
  if (db) return db;

  try {
    client = new MongoClient(url);
    await client.connect();
    console.log('✅ Successfully connected to local MongoDB');
    db = client.db(dbName);
    return db;
  } catch (error) {
    console.error('❌ Failed to connect to local MongoDB:', error);
    throw error;
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectToLocalMongo first.');
  }
  return db;
}

export async function closeLocalMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
