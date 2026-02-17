const mongoose = require('mongoose');
const URI = 'mongodb+srv://extrahand614_db_user:aEgPtYiKNpHuSjDU@cluster0.wjubwjn.mongodb.net/?appName=Cluster0';

async function cleanup() {
    try {
        await mongoose.connect(URI);
        console.log('Connected to cleanup...');

        const db = mongoose.connection.db;
        const collection = db.collection('chatsessions');

        // Find documents with missing or null ticket_id
        const count = await collection.countDocuments({
            $or: [
                { ticket_id: null },
                { ticket_id: { $exists: false } }
            ]
        });

        console.log(`Found ${count} documents with invalid ticket_id`);

        if (count > 0) {
            const result = await collection.deleteMany({
                $or: [
                    { ticket_id: null },
                    { ticket_id: { $exists: false } }
                ]
            });
            console.log(`Successfully deleted ${result.deletedCount} invalid documents.`);
        }

        // List indexes to check uniqueness
        const indexes = await collection.indexes();
        console.log('Current Indexes:', JSON.stringify(indexes, null, 2));

        await mongoose.disconnect();
    } catch (err) {
        console.error('Cleanup Error:', err);
    }
}

cleanup();
