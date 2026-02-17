const mongoose = require('mongoose');
const URI = 'mongodb+srv://extrahand614_db_user:aEgPtYiKNpHuSjDU@cluster0.wjubwjn.mongodb.net/?appName=Cluster0';

console.log('--- MongoDB Connection Test ---');
console.log('Attempting to connect to:', URI.split('@')[1]); // Hide credentials in log

async function test() {
    try {
        console.log('Status: Connecting...');
        await mongoose.connect(URI, {
            serverSelectionTimeoutMS: 5000, // Fail fast for testing
        });
        console.log('✅ SUCCESS: Connected to MongoDB Atlas!');

        // Try a simple operation
        const count = await mongoose.connection.db.admin().listDatabases();
        console.log('✅ SUCCESS: Verified access. Databases found:', count.databases.length);

        await mongoose.disconnect();
        console.log('Status: Disconnected safely.');
    } catch (err) {
        console.error('❌ FAILURE: Could not connect.');
        console.error('Error Name:', err.name);
        console.error('Error Message:', err.message);
        if (err.reason) {
            console.error('Detailed Reason:', JSON.stringify(err.reason, null, 2));
        }
    }
}

test();
