require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure WebSocket for Node.js environment
const { neonConfig } = require('@neondatabase/serverless');
neonConfig.webSocketConstructor = ws;

async function testConnection() {
    console.log('Testing PG Connection...');
    console.log('URL:', process.env.DATABASE_URL);

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connected to PostgreSQL successfully!');
        const res = await client.query('SELECT NOW()');
        console.log('Current Time from DB:', res.rows[0]);
        client.release();
        await pool.end();
        return true;
    } catch (err) {
        console.error('❌ Connection failed:', err);
        return false;
    }
}

testConnection();
