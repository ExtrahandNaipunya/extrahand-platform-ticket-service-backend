require('dotenv').config();

const db = require('./database-mongo-ext');

async function run() {
  try {
    await db.initializeDatabase();
    const result = await db.backfillInquiryAssignedAgentIds();
    console.log('[Backfill] Inquiry assigned agent id migration complete:', result);
    process.exit(0);
  } catch (error) {
    console.error('[Backfill] Failed:', error);
    process.exit(1);
  }
}

run();
