
import axios from 'axios';
import express from 'express';
import { connectToLocalMongo, getDb } from '../src/db';
import * as dotenv from 'dotenv';
import interfaceRouter from '../src/interfaces/index';
import { Server } from 'http';

dotenv.config();

let server: Server;
const TEST_PORT = 3333;
const API_URL = `http://127.0.0.1:${TEST_PORT}/api`;

// Test Users
const INVITER_OPENID = 'TEST_INVITER_001';
const INVITEE_OPENID = 'TEST_INVITEE_001';
const TEST_INVITE_CODE = 'TESTCODE123';

async function startTestServer() {
    const app = express();
    app.use(express.json());
    app.use(interfaceRouter); // Mounts on /api inside index.ts?
    // src/interfaces/index.ts does: router.use('/api', ...);
    // So if we app.use(interfaceRouter), it will handle /api/...
    // Let's verify index.ts: "router.use('/api', activateMembership);"
    // So yes, app.use(interfaceRouter) works.
    
    return new Promise<void>((resolve) => {
        server = app.listen(TEST_PORT, () => {
            console.log(`Test server running on port ${TEST_PORT}`);
            resolve();
        });
    });
}

async function stopTestServer() {
    return new Promise<void>((resolve) => {
        if (server) {
            server.close(() => resolve());
        } else {
            resolve();
        }
    });
}

async function setupUsers() {
    const db = getDb();
    const usersCol = db.collection('users');

    // 1. Reset Inviter: Level 3 (Advance), expires in 10 days
    await usersCol.deleteOne({ openid: INVITER_OPENID });
    
    const inviterExpireDate = new Date();
    inviterExpireDate.setDate(inviterExpireDate.getDate() + 10);

    await usersCol.insertOne({
        openid: INVITER_OPENID,
        nickname: 'Test Inviter',
        inviteCode: TEST_INVITE_CODE,
        membership: {
            level: 3, // Premium Level
            expire_at: inviterExpireDate,
            pts_quota: { limit: 100, used: 0 }
        }
    });

    // 2. Reset Invitee: Level 0 (New)
    await usersCol.deleteOne({ openid: INVITEE_OPENID });
    await usersCol.insertOne({
        openid: INVITEE_OPENID,
        nickname: 'Test Invitee',
        hasUsedInviteCode: false,
        membership: {
            level: 0,
            expire_at: null,
            pts_quota: { limit: 0, used: 0 }
        }
    });
}

async function verifyResults() {
    const db = getDb();
    const usersCol = db.collection('users');

    // Check Inviter
    const inviter = await usersCol.findOne({ openid: INVITER_OPENID });
    const inviterLevel = inviter?.membership?.level;
    const inviterExpire = new Date(inviter?.membership?.expire_at);
    // Should be > 10 days + 3 days ~= 13 days
    const daysLeft = (inviterExpire.getTime() - Date.now()) / (1000 * 3600 * 24);

    console.log('--- Inviter Status ---');
    console.log(`Level: ${inviterLevel} (Expected: 3)`);
    console.log(`Days Left: ${daysLeft.toFixed(1)} (Expected: ~13.0)`);

    if (inviterLevel !== 3) {
        console.error('FAILED: Inviter level dropped!');
    } else {
        console.log('PASSED: Inviter level maintained.');
    }
    
    if (daysLeft < 12.5) {
        console.error('FAILED: Inviter time not extended properly!');
    } else {
        console.log('PASSED: Inviter time extended.');
    }

    // Check Invitee
    const invitee = await usersCol.findOne({ openid: INVITEE_OPENID });
    const inviteeLevel = invitee?.membership?.level;
    console.log('--- Invitee Status ---');
    console.log(`Level: ${inviteeLevel} (Expected: 1)`);
}

async function setupUsersScenarioB() {
     const db = getDb();
    const usersCol = db.collection('users');

    // 1. Reset Inviter: Level 3
    await usersCol.deleteOne({ openid: INVITER_OPENID });
    const inviterExpireDate = new Date();
    inviterExpireDate.setDate(inviterExpireDate.getDate() + 10);
    await usersCol.insertOne({
        openid: INVITER_OPENID,
        nickname: 'Test Inviter',
        inviteCode: TEST_INVITE_CODE,
        membership: {
            level: 3,
            expire_at: inviterExpireDate,
            pts_quota: { limit: 100, used: 0 }
        }
    });

    // 2. Reset Invitee: Also Level 3!
    await usersCol.deleteOne({ openid: INVITEE_OPENID });
    const inviteeExpireDate = new Date();
    inviteeExpireDate.setDate(inviteeExpireDate.getDate() + 5);

    await usersCol.insertOne({
        openid: INVITEE_OPENID,
        nickname: 'Test Invitee Premium',
        hasUsedInviteCode: false,
        membership: {
            level: 3,
            expire_at: inviteeExpireDate,
            pts_quota: { limit: 100, used: 0 }
        }
    });
}

async function verifyResultsScenarioB() {
    const db = getDb();
    const usersCol = db.collection('users');

    // Check Inviter
    const inviter = await usersCol.findOne({ openid: INVITER_OPENID });
    if (inviter?.membership?.level !== 3) console.error('FAILED: Inviter level changed (B)');
    else console.log('PASSED: Inviter level maintained (B)');

    // Check Invitee
    const invitee = await usersCol.findOne({ openid: INVITEE_OPENID });
    if (invitee?.membership?.level !== 3) console.error('FAILED: Invitee level dropped (B)');
    else console.log('PASSED: Invitee level maintained (B)');
    
    // Check Days added
    const inviteeExpire = new Date(invitee?.membership?.expire_at);
    // 5 + 3 = 8 days
    const daysLeft = (inviteeExpire.getTime() - Date.now()) / (1000 * 3600 * 24);
    console.log(`Invitee Days Left: ${daysLeft.toFixed(1)} (Expected: ~8.0)`);
    if(daysLeft < 7.5) console.error('FAILED: Invitee time not extended (B)');
    else console.log('PASSED: Invitee time extended (B)');
}


async function runTest() {
    try {
        await connectToLocalMongo();
        await startTestServer();
        
        console.log('\n=== Scenario A: High Level Inviter, New Invitee ===');
        await setupUsers();
        try {
            const res = await axios.post(`${API_URL}/applyInviteCode`, {
                targetInviteCode: TEST_INVITE_CODE,
                openid: INVITEE_OPENID // Simulating invitee making the request
            });
            console.log('API Response Message:', res.data.message);
        } catch (e: any) {
            console.error('API Error:', e.response?.data || e.message);
        }
        await verifyResults();


        console.log('\n=== Scenario B: High Level Inviter, High Level Invitee ===');
        await setupUsersScenarioB();
        try {
            const res = await axios.post(`${API_URL}/applyInviteCode`, {
                targetInviteCode: TEST_INVITE_CODE,
                openid: INVITEE_OPENID 
            });
            console.log('API Response Message:', res.data.message);
        } catch (e: any) {
             console.error('API Error:', e.response?.data || e.message);
        }
        await verifyResultsScenarioB();

    } catch (err) {
        console.error('Test Execution Error:', err);
    } finally {
        await stopTestServer();
        process.exit();
    }
}

runTest();
