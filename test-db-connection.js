require('dotenv').config();
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
console.log('Testing connection with URL from .env...');
console.log('URL (masked):', databaseUrl.replace(/:[^:]*@/, ':****@'));

const pool = new Pool({
    connectionString: databaseUrl,
});

async function testConnection() {
    try {
        console.log('Attempting to connect...');
        const client = await pool.connect();
        console.log('✅ Connected successfully!');
        const res = await client.query('SELECT NOW()');
        console.log('Server time:', res.rows[0]);
        client.release();
        process.exit(0);
    } catch (err) {
        console.error('❌ Connection failed:', err);
        if (err.code === 'ENOTFOUND') {
            console.error('\nPOSSIBLE CAUSE: The hostname (domain) in the connection string is invalid or blocked.');
        } else if (err.code === '28P01') {
            console.error('\nPOSSIBLE CAUSE: Invalid username or password.');
        }
        process.exit(1);
    }
}

testConnection();
