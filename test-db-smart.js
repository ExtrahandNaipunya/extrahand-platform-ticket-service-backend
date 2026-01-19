require('dotenv').config();
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

// 1. Get the current (user provided) URL
const rawUrl = process.env.DATABASE_URL;

// 2. Construct the "Corrected" URL (removing .c-2)
const correctedUrl = rawUrl
    .replace('.c-3.us-east-1', '.us-east-1')
    .replace('.c-2.us-east-1', '.us-east-1')
    .replace('-pooler', '')
    .replace('&channel_binding=require', '');

async function tryConnection(connectionString, label) {
    console.log(`\nTesting ${label}...`);
    console.log('URL (masked):', connectionString.replace(/:[^:]*@/, ':****@'));

    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        console.log(`✅ ${label} CONNECTED SUCCESSFULLY!`);
        const res = await client.query('SELECT NOW()');
        console.log('Server time:', res.rows[0]);
        client.release();
        return true;
    } catch (err) {
        console.log(`❌ ${label} Failed: ${err.code || err.message}`);
        if (err.code === 'ENOTFOUND') {
            console.log('   (DNS Error - Host not found)');
        } else if (err.code === '28P01') {
            console.log('   (Auth Error - Wrong Password)');
        }
        return false;
    } finally {
        await pool.end();
    }
}

async function run() {
    // Attempt 1: As provided
    const successOriginal = await tryConnection(rawUrl, "User Provided URL");
    if (successOriginal) {
        console.log('\n>>> SUCCESS! The user provided URL works as is.');
        process.exit(0);
    }

    // Attempt 2: Corrected
    const successCorrected = await tryConnection(correctedUrl, "Corrected URL (No .c-2)");
    if (successCorrected) {
        console.log('\n>>> DISCOVERY: The user provided URL failed, BUT the corrected version worked!');
        console.log('>>> I will now update the .env file automatically.');

        // Auto-fix the .env file
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(rawUrl, correctedUrl);
        fs.writeFileSync(envPath, envContent);
        console.log('✅ .env file updated with working URL.');
        process.exit(0);
    }

    console.log('\n❌ BOTH attempts failed. Please check username/password and internet connection.');
    process.exit(1);
}

run();
