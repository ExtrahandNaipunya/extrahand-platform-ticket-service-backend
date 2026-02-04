const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure WebSocket for Node.js environment (Neon serverless requires this)
neonConfig.webSocketConstructor = ws;

// Neon PostgreSQL connection using serverless driver (bypasses DNS issues with .c-2)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
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

    // Create system_settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL
      )
    `);

    // Insert default settings if empty
    const settingsCheck = await client.query('SELECT COUNT(*) FROM system_settings');
    if (parseInt(settingsCheck.rows[0].count) === 0) {
      const defaultSettings = {
        siteName: 'ExtraHand Support',
        supportEmail: 'support@extrahand.com',
        operatingHours: '9:00 AM - 6:00 PM',
        timezone: 'Asia/Kolkata (IST)',
        enableEmailNotifications: true,
        enableSoundAlerts: true,
        autoAssignChats: true,
        maintenanceMode: false
      };

      for (const [key, value] of Object.entries(defaultSettings)) {
        await client.query('INSERT INTO system_settings (key, value) VALUES ($1, $2)', [key, JSON.stringify(value)]);
      }
    }

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

async function getClosedSessions(agentEmail = null, customerEmail = null, limit = null) {
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

    if (limit) {
      query += ` LIMIT ${parseInt(limit)}`;
    }

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

// Analytics operations
async function getSystemStats() {
  const client = await pool.connect();
  try {
    // 1. Total Tickets Count
    const totalTicketsResult = await client.query('SELECT COUNT(*) FROM chat_sessions');
    const totalTickets = parseInt(totalTicketsResult.rows[0].count);

    // 2. Active Agents Count
    const activeAgentsResult = await client.query('SELECT COUNT(DISTINCT agent_email) FROM chat_sessions WHERE status = \'active\' AND agent_email IS NOT NULL');
    const activeAgents = parseInt(activeAgentsResult.rows[0].count);

    // 3. Avg Resolution Time
    const resolutionTimeResult = await client.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (closed_at - joined_at))) as avg_seconds
      FROM chat_sessions 
      WHERE status = 'closed' AND joined_at IS NOT NULL AND closed_at IS NOT NULL
    `);
    const avgResolutionSeconds = resolutionTimeResult.rows[0].avg_seconds || 0;
    const minutes = Math.floor(avgResolutionSeconds / 60);
    const avgResolutionTime = `${minutes}m ${Math.round(avgResolutionSeconds % 60)}s`;

    // 4. Ticket Status Breakdown
    const statusResult = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM chat_sessions 
      GROUP BY status
    `);
    const statusBreakdown = {
      pending: 0,
      active: 0,
      closed: 0
    };
    statusResult.rows.forEach(row => {
      if (statusBreakdown[row.status] !== undefined) {
        statusBreakdown[row.status] = parseInt(row.count);
      }
    });

    // 5. Recent Activity (Last 5 tickets created)
    const recentActivityResult = await client.query(`
      SELECT id, customer_name, status, created_at, issue_type_label 
      FROM chat_sessions 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    return {
      total_tickets: totalTickets,
      active_agents: activeAgents,
      avg_resolution_time: avgResolutionTime,
      status_breakdown: statusBreakdown,
      recent_activity: recentActivityResult.rows
    };
  } finally {
    client.release();
  }
}

async function getAgentPerformance() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        agent_email,
        COUNT(*) as total_chats,
        AVG(rating) as avg_rating,
        AVG(EXTRACT(EPOCH FROM (closed_at - joined_at))) as avg_duration_seconds
      FROM chat_sessions
      WHERE agent_email IS NOT NULL AND status = 'closed'
      GROUP BY agent_email
      ORDER BY total_chats DESC
    `);

    return result.rows.map(row => ({
      agent_email: row.agent_email,
      total_chats: parseInt(row.total_chats),
      avg_rating: row.avg_rating ? parseFloat(row.avg_rating).toFixed(1) : 'N/A',
      avg_duration: row.avg_duration_seconds
        ? `${Math.floor(row.avg_duration_seconds / 60)}m`
        : 'N/A'
    }));
  } finally {
    client.release();
  }
}

async function getAllActiveSessions() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT cs.*, 
        (SELECT content FROM chat_messages WHERE session_id = cs.id ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT sender_type FROM chat_messages WHERE session_id = cs.id ORDER BY timestamp DESC LIMIT 1) as last_sender
      FROM chat_sessions cs
      WHERE cs.status = 'active'
      ORDER BY cs.joined_at DESC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

// Settings operations
async function getSettings() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM system_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  } finally {
    client.release();
  }
}

async function updateSettings(newSettings) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(newSettings)) {
      await client.query(
        'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');
    return await getSettings();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
  getActiveSessionForCustomer,
  getSystemStats,
  getAgentPerformance,
  getAllActiveSessions,
  getSettings,
  updateSettings
};
