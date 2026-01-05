const { Pool } = require('pg');

// Neon PostgreSQL connection
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_l9IKRiHJvBo6@ep-misty-band-adftugtg-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Create sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        agent_email VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        joined_at TIMESTAMP,
        closed_at TIMESTAMP,
        resolution_note TEXT,
        ticket_id VARCHAR(50),
        issue_category VARCHAR(100),
        issue_type VARCHAR(100),
        issue_category_label VARCHAR(255),
        issue_type_label VARCHAR(255),
        rating INTEGER
      )
    `);

    // Create messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        sender_type VARCHAR(50) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_customer_email ON chat_sessions(customer_email);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_email ON chat_sessions(agent_email);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON chat_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_ticket_id ON chat_sessions(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON chat_messages(session_id);
    `);

    console.log('✅ PostgreSQL database initialized');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Session operations
async function createSession(customerName, customerEmail, issueData = {}) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO chat_sessions 
       (customer_name, customer_email, status, issue_category, issue_type, issue_category_label, issue_type_label) 
       VALUES ($1, $2, 'pending', $3, $4, $5, $6) 
       RETURNING *`,
      [
        customerName, 
        customerEmail, 
        issueData.category || null,
        issueData.type || null,
        issueData.categoryLabel || null,
        issueData.typeLabel || null
      ]
    );
    
    const session = result.rows[0];
    // Generate ticket ID
    const ticketId = `TICKET-${session.id.toString().padStart(6, '0')}`;
    await client.query('UPDATE chat_sessions SET ticket_id = $1 WHERE id = $2', [ticketId, session.id]);
    session.ticket_id = ticketId;
    
    return session;
  } finally {
    client.release();
  }
}

async function getSession(sessionId) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM chat_sessions WHERE id = $1', [sessionId]);
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function updateSessionStatus(sessionId, status, agentEmail = null) {
  const client = await pool.connect();
  try {
    let query = 'UPDATE chat_sessions SET status = $1';
    const params = [status, sessionId];
    
    if (agentEmail) {
      query += ', agent_email = $3, joined_at = CURRENT_TIMESTAMP';
      params.splice(2, 0, agentEmail);
    }
    
    query += ' WHERE id = $2 RETURNING *';
    const result = await client.query(query, params);
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function closeSession(sessionId, resolutionNote = null) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE chat_sessions 
       SET status = 'closed', closed_at = CURRENT_TIMESTAMP, resolution_note = $1 
       WHERE id = $2 
       RETURNING *`,
      [resolutionNote, sessionId]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getPendingSessions() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT * FROM chat_sessions WHERE status = 'pending' ORDER BY created_at ASC"
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function getActiveSessions(agentEmail = null) {
  const client = await pool.connect();
  try {
    let query = "SELECT * FROM chat_sessions WHERE status = 'active'";
    const params = [];
    
    if (agentEmail) {
      query += " AND agent_email = $1";
      params.push(agentEmail);
    }
    
    query += " ORDER BY joined_at DESC";
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function getClosedSessions(agentEmail = null, customerEmail = null) {
  const client = await pool.connect();
  try {
    let query = "SELECT * FROM chat_sessions WHERE status = 'closed'";
    const params = [];
    let paramIndex = 1;
    
    if (agentEmail) {
      query += ` AND agent_email = $${paramIndex}`;
      params.push(agentEmail);
      paramIndex++;
    }
    
    if (customerEmail) {
      query += ` AND customer_email = $${paramIndex}`;
      params.push(customerEmail);
      paramIndex++;
    }
    
    query += " ORDER BY closed_at DESC";
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function getSessionByTicketId(ticketId) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM chat_sessions WHERE ticket_id = $1', [ticketId]);
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Message operations
async function addMessage(sessionId, content, senderType) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'INSERT INTO chat_messages (session_id, content, sender_type) VALUES ($1, $2, $3) RETURNING *',
      [sessionId, content, senderType]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getMessages(sessionId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY timestamp ASC',
      [sessionId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// Check if there's an active session for a customer
async function getActiveSessionForCustomer(customerEmail) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT * FROM chat_sessions WHERE customer_email = $1 AND status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1",
      [customerEmail]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initializeDatabase,
  createSession,
  getSession,
  updateSessionStatus,
  closeSession,
  getPendingSessions,
  getActiveSessions,
  getClosedSessions,
  getSessionByTicketId,
  addMessage,
  getMessages,
  getActiveSessionForCustomer
};
