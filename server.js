const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { QueueManager } = require('./redis');
const { getTypeLabel } = require('./issue-categories');
const dbPG = require('./database-pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors({
  origin: ['http://localhost:3004', 'http://localhost:3005', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Initialize PostgreSQL database
dbPG.initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

console.log('✅ PostgreSQL Database initialized');

// In-memory connection tracking
const connections = {
  agents: new Map(),      // email -> WebSocket
  customers: new Map()    // sessionId -> WebSocket
};

// Queue locking mechanism to prevent race conditions
const sessionLocks = new Map(); // sessionId -> { locked: boolean, agentEmail: string, timestamp: number }

function tryLockSession(sessionId, agentEmail) {
  const lock = sessionLocks.get(sessionId);
  
  // Check if already locked
  if (lock && lock.locked) {
    const timeSinceLock = Date.now() - lock.timestamp;
    // If lock is older than 5 seconds, consider it stale and allow override
    if (timeSinceLock < 5000) {
      console.log(`[Lock] Session ${sessionId} already locked by ${lock.agentEmail}`);
      return false;
    }
    console.log(`[Lock] Stale lock detected for session ${sessionId}, overriding`);
  }
  
  // Lock the session
  sessionLocks.set(sessionId, {
    locked: true,
    agentEmail: agentEmail,
    timestamp: Date.now()
  });
  console.log(`[Lock] Session ${sessionId} locked by ${agentEmail}`);
  return true;
}

function unlockSession(sessionId) {
  sessionLocks.delete(sessionId);
  console.log(`[Lock] Session ${sessionId} unlocked`);
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  console.log('[WebSocket] New connection:', url.pathname);

  if (pathParts[0] === 'ws') {
    if (pathParts[1] === 'agent') {
      // Agent connection
      const agentEmail = decodeURIComponent(pathParts[2]);
      connections.agents.set(agentEmail, ws);
      console.log(`[Agent] Connected: ${agentEmail}`);

      // Send pending and active chats
      sendDashboardUpdate(agentEmail);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleAgentMessage(agentEmail, message);
        } catch (error) {
          console.error('[Agent] Message parse error:', error);
        }
      });

      ws.on('close', () => {
        connections.agents.delete(agentEmail);
        console.log(`[Agent] Disconnected: ${agentEmail}`);
      });

    } else if (pathParts[1] === 'customer') {
      // Customer connection
      const sessionId = parseInt(pathParts[2]);
      
      // Prevent duplicate connections - close old connection if exists
      if (connections.customers.has(sessionId)) {
        console.log(`[Customer] Duplicate connection attempt for session ${sessionId} - closing old connection`);
        const oldWs = connections.customers.get(sessionId);
        if (oldWs && oldWs.readyState === WebSocket.OPEN) {
          oldWs.close();
        }
      }
      
      connections.customers.set(sessionId, ws);
      console.log(`[Customer] Connected: Session ${sessionId}`);

      // Send chat history
      sendChatHistory(sessionId, ws);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleCustomerMessage(sessionId, message);
        } catch (error) {
          console.error('[Customer] Message parse error:', error);
        }
      });

      ws.on('error', (error) => {
        console.error(`[Customer] WebSocket error for session ${sessionId}:`, error.message);
      });

      ws.on('close', () => {
        connections.customers.delete(sessionId);
        console.log(`[Customer] Disconnected: Session ${sessionId}`);
      });
    }
  }
});

// Handle agent messages
function handleAgentMessage(agentEmail, message) {
  console.log(`[Agent ${agentEmail}] Message:`, message);

  switch (message.action) {
    case 'join_chat':
      joinChat(agentEmail, message.session_id);
      break;
    case 'open_chat':
      // Agent opening existing chat - send history
      sendChatHistory(message.session_id, connections.agents.get(agentEmail));
      break;
    case 'send_message':
      sendMessageToCustomer(message.session_id, message.content, 'agent');
      break;
    case 'close_session':
      closeSession(message.session_id, message.resolution_note);
      break;
  }
}

// Handle customer messages
function handleCustomerMessage(sessionId, message) {
  console.log(`[Customer Session ${sessionId}] Message:`, message);

  if (message.action === 'send_message') {
    sendMessageToAgent(sessionId, message.content, 'customer');
  }
}

// Join chat (agent accepts)
async function joinChat(agentEmail, sessionId) {
  console.log(`[Join Chat] Agent ${agentEmail} attempting to join session ${sessionId}`);
  
  // Try to lock the session
  if (!tryLockSession(sessionId, agentEmail)) {
    // Session already taken by another agent
    const agentWs = connections.agents.get(agentEmail);
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({
        type: 'chat_already_taken',
        session_id: sessionId,
        message: 'This chat was already accepted by another agent'
      }));
    }
    console.log(`[Join Chat] Session ${sessionId} already taken, rejected agent ${agentEmail}`);
    return;
  }
  
  const session = await dbPG.getSession(sessionId);
  if (!session) {
    unlockSession(sessionId);
    console.log(`[Join Chat] Session ${sessionId} not found`);
    return;
  }
  
  // Check if session is already assigned
  if (session.status === 'active' && session.agent_email && session.agent_email !== agentEmail) {
    unlockSession(sessionId);
    const agentWs = connections.agents.get(agentEmail);
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({
        type: 'chat_already_taken',
        session_id: sessionId,
        message: 'This chat is already assigned to another agent'
      }));
    }
    console.log(`[Join Chat] Session ${sessionId} already assigned to ${session.agent_email}`);
    return;
  }
  
  // Assign session to agent in PostgreSQL
  await dbPG.updateSessionStatus(sessionId, 'active', agentEmail);

  // Remove from Redis queue
  QueueManager.removeFromQueue(sessionId).catch(err => {
    console.error(`[Redis] Failed to remove session ${sessionId} from queue:`, err);
  });

  // Get agent name from email
  const agentName = agentEmail.split('@')[0];

  // Notify the agent who accepted
  const agentWs = connections.agents.get(agentEmail);
  if (agentWs && agentWs.readyState === WebSocket.OPEN) {
    await sendDashboardUpdate(agentEmail);
    await sendChatHistory(sessionId, agentWs);
    console.log(`[Join Chat] Notified agent ${agentEmail}`);
  }

  // Notify customer
  const customerWs = connections.customers.get(sessionId);
  console.log(`[Join Chat] Customer WebSocket for session ${sessionId}:`, {
    exists: !!customerWs,
    readyState: customerWs?.readyState,
    readyStateText: customerWs ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][customerWs.readyState] : 'N/A'
  });
  
  if (customerWs && customerWs.readyState === WebSocket.OPEN) {
    const joinMessage = {
      type: 'agent_joined',
      message: `${agentName} has joined the chat`,
      agent_email: agentEmail,
      agent_name: agentName
    };
    console.log(`[Join Chat] Sending agent_joined message to customer:`, joinMessage);
    customerWs.send(JSON.stringify(joinMessage));
    console.log(`[Join Chat] Successfully sent agent_joined to customer`);
  } else {
    console.log(`[Join Chat] ERROR: Cannot send agent_joined - Customer WebSocket not available for session ${sessionId}`);
    console.log(`[Join Chat] Active customer connections:`, Array.from(connections.customers.keys()));
  }
  
  // Broadcast to ALL other agents that this chat was taken
  broadcastChatTaken(sessionId, agentEmail);

  console.log(`[Join Chat] Completed - Agent ${agentEmail} joined session ${sessionId}`);
}

// Broadcast to all agents that a chat was taken
function broadcastChatTaken(sessionId, acceptingAgentEmail) {
  console.log(`[Broadcast] Notifying all agents that session ${sessionId} was taken by ${acceptingAgentEmail}`);
  
  connections.agents.forEach((ws, agentEmail) => {
    if (agentEmail !== acceptingAgentEmail && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat_taken',
        session_id: sessionId,
        taken_by: acceptingAgentEmail
      }));
      console.log(`[Broadcast] Notified agent ${agentEmail} about taken session ${sessionId}`);
    }
  });
}

// Broadcast dashboard updates to ALL connected agents
function broadcastDashboardUpdates() {
  connections.agents.forEach((ws, agentEmail) => {
    sendDashboardUpdate(agentEmail);
  });
}

// Send message to customer
async function sendMessageToCustomer(sessionId, content, sender) {
  // Save to PostgreSQL database
  try {
    await dbPG.addMessage(sessionId, content, sender);
  } catch (error) {
    console.error('[DB Error] Failed to save message:', error);
  }

  const messageData = {
    type: 'message',
    session_id: sessionId,
    content,
    sender,
    timestamp: new Date().toISOString()
  };

  // Send to customer
  const customerWs = connections.customers.get(sessionId);
  if (customerWs && customerWs.readyState === WebSocket.OPEN) {
    customerWs.send(JSON.stringify(messageData));
  }

  // Send to all agents viewing this session
  connections.agents.forEach((ws, email) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(messageData));
    }
  });

  console.log(`[Message] Sent to session ${sessionId}: ${content.substring(0, 50)}...`);
}

// Send message to agent
async function sendMessageToAgent(sessionId, content, sender) {
  // Save to PostgreSQL database
  try {
    await dbPG.addMessage(sessionId, content, sender);
  } catch (error) {
    console.error('[DB Error] Failed to save message:', error);
  }

  const messageData = {
    type: 'message',
    session_id: sessionId,
    content,
    sender,
    timestamp: new Date().toISOString()
  };

  // Get session info
  const session = await dbPG.getSession(sessionId);

  // Send to assigned agent
  if (session && session.agent_email) {
    const agentWs = connections.agents.get(session.agent_email);
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify(messageData));
    }
  }

  // Send to customer
  const customerWs = connections.customers.get(sessionId);
  if (customerWs && customerWs.readyState === WebSocket.OPEN) {
    customerWs.send(JSON.stringify(messageData));
  }

  console.log(`[Message] From customer in session ${sessionId}: ${content.substring(0, 50)}...`);
}

// Send chat history
async function sendChatHistory(sessionId, ws) {
  try {
    const messages = await dbPG.getMessages(sessionId);
    const session = await dbPG.getSession(sessionId);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'history',
        session_id: sessionId,
        session: session,
        messages: messages.map(msg => ({
          content: msg.content,
          sender: msg.sender_type || msg.sender,
          timestamp: msg.timestamp
        }))
      }));
      
      // If session is already active, notify that agent has joined
      if (session && session.status === 'active' && session.agent_email) {
        const agentName = session.agent_email.split('@')[0];
        ws.send(JSON.stringify({
          type: 'agent_joined',
          message: `${agentName} has joined the chat`,
          agent_email: session.agent_email,
          agent_name: agentName
        }));
      }
    }
  } catch (error) {
    console.error('[DB Error] Failed to fetch chat history:', error);
  }
}

// Send dashboard update to agent
async function sendDashboardUpdate(agentEmail) {
  try {
    // Get pending sessions from PostgreSQL
    const pendingSessions = await dbPG.getPendingSessions();
    // Get unique pending sessions (by customer email)
    const pendingMap = new Map();
    pendingSessions.forEach(session => {
      if (!pendingMap.has(session.customer_email)) {
        pendingMap.set(session.customer_email, session);
      }
    });
    const pending = Array.from(pendingMap.values());
    
    // Get active sessions for this agent from PostgreSQL
    const activeSessions = await dbPG.getActiveSessions(agentEmail);
    // Get unique active sessions (by customer email)
    const activeMap = new Map();
    activeSessions.forEach(session => {
      if (!activeMap.has(session.customer_email)) {
        activeMap.set(session.customer_email, session);
      }
    });
    const active = Array.from(activeMap.values());

    const agentWs = connections.agents.get(agentEmail);
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({
        type: 'dashboard_update',
        pending,
        active
      }));
    }
  } catch (error) {
    console.error('[DB Error] Failed to fetch dashboard data:', error);
  }
}

// Close session
async function closeSession(sessionId, resolutionNote) {
  try {
    const session = await dbPG.closeSession(sessionId, resolutionNote);
    if (session) {
      // Add system message
      if (resolutionNote) {
        await dbPG.addMessage(sessionId, `Session closed. Resolution: ${resolutionNote}`, 'system');
      }

      // Notify customer
      const customerWs = connections.customers.get(sessionId);
      if (customerWs && customerWs.readyState === WebSocket.OPEN) {
        customerWs.send(JSON.stringify({
          type: 'session_closed',
          session_id: sessionId,
          message: 'This chat session has been closed. Thank you for contacting support!'
        }));
      }

      // Notify all agents
      connections.agents.forEach((ws, email) => {
        sendDashboardUpdate(email);
      });

      console.log(`[Session] Closed: ${sessionId}`);
    }
  } catch (error) {
    console.error('[DB Error] Failed to close session:', error);
  }
}

// REST API Endpoints

// Create new chat session
app.post('/api/sessions', async (req, res) => {
  const { 
    customer_name, 
    customer_email,
    issue_category = 'general',
    issue_type = 'other',
    issue_category_label = 'General Inquiry',
    issue_type_label = 'Other inquiry'
  } = req.body;
  
  // Check for existing active or pending session for this customer
  const existingSession = await dbPG.getActiveSessionForCustomer(customer_email);
  
  if (existingSession) {
    console.log(`[Session] Returning existing session ${existingSession.id} for ${customer_email}`);
    return res.json({ session_id: existingSession.id });
  }
  
  const newSession = await dbPG.createSession(customer_name, customer_email, {
    category: issue_category,
    type: issue_type,
    categoryLabel: issue_category_label,
    typeLabel: issue_type_label
  });

  // Add to Redis queue for better management
  await QueueManager.addToQueue(
    newSession.id,
    issue_category,
    issue_type_label,
    {
      name: customer_name,
      email: customer_email,
      category_label: issue_category_label,
      type_label: issue_type_label
    }
  );

  // Notify all connected agents about new pending chat
  connections.agents.forEach((ws, email) => {
    sendDashboardUpdate(email);
  });

  console.log(`[Session] Created new session ${newSession.id} for ${customer_email} - Issue: ${issue_type_label}`);
  res.json({ session_id: newSession.id });
});

// Get session info
app.get('/api/sessions/:id', async (req, res) => {
  const session = await dbPG.getSession(parseInt(req.params.id));
  res.json(session || {});
});

// Check if customer can start new chat
app.get('/api/customer/can-chat/:email', async (req, res) => {
  const { email } = req.params;
  const activeSession = await dbPG.getActiveSessionForCustomer(email);
  
  res.json({
    can_chat: !activeSession,
    active_session_id: activeSession ? activeSession.id : null,
    message: activeSession 
      ? 'You have an active chat session. Please close it before starting a new one.' 
      : 'You can start a new chat session.'
  });
});

// Close session via API
app.post('/api/sessions/:id/close', (req, res) => {
  const { resolution_note } = req.body;
  closeSession(parseInt(req.params.id), resolution_note);
  res.json({ success: true });
});

// Quick replies endpoint
app.get('/api/agent/quick-replies', (req, res) => {
  res.json({
    quick_replies: [
      { id: 1, category: 'greeting', text: 'Hello! How can I help you today?', icon: '👋' },
      { id: 2, category: 'closing', text: 'Is there anything else I can help you with?', icon: '❓' },
      { id: 3, category: 'thanks', text: 'Thank you for contacting ExtraHand support!', icon: '🙏' },
      { id: 4, category: 'waiting', text: 'Please give me a moment to check that for you.', icon: '⏳' },
      { id: 5, category: 'escalate', text: 'Let me escalate this to our senior team.', icon: '⬆️' }
    ]
  });
});

// Customer chat history endpoint
app.get('/api/customer/history/:email', async (req, res) => {
  const { email } = req.params;
  
  try {
    // Find all closed sessions for this customer
    const closedSessions = await dbPG.getClosedSessions(null, email);
    
    // Format for frontend
    const formattedSessions = closedSessions.map(session => ({
      id: session.id,
      ticket_id: session.ticket_id,
      agent_name: session.agent_email ? session.agent_email.split('@')[0] : 'Unknown',
      created_at: session.created_at,
      closed_at: session.closed_at,
      resolution_note: session.resolution_note || 'No resolution note provided',
      issue_category: session.issue_category,
      issue_type: session.issue_type,
      issue_category_label: session.issue_category_label,
      issue_type_label: session.issue_type_label,
      rating: session.rating
    }));
    
    res.json({ sessions: formattedSessions });
  } catch (error) {
    console.error('[API Error] Failed to fetch customer history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get ticket history with messages
app.get('/api/ticket/history/:ticket_id', async (req, res) => {
  const { ticket_id } = req.params;
  
  try {
    const session = await dbPG.getSessionByTicketId(ticket_id);
    if (!session) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    // Get all messages for this session
    const messages = await dbPG.getMessages(session.id);
    
    res.json({
      ...session,
      ticket_id,
      messages: messages.map(msg => ({
        content: msg.content,
        sender_type: msg.sender_type,
        timestamp: msg.timestamp
      }))
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch ticket history:', error);
    res.status(500).json({ error: 'Failed to fetch ticket history' });
  }
});

// Agent chat history endpoint
app.get('/api/agent/history/:username', async (req, res) => {
  const { username } = req.params;
  
  try {
    // Find all closed sessions for this agent
    const closedSessions = await dbPG.getClosedSessions(username);
    
    // Format for frontend
    const formattedSessions = closedSessions.map(session => ({
      id: session.id,
      ticket_id: session.ticket_id,
      customer_name: session.customer_name,
      customer_email: session.customer_email,
      created_at: session.created_at,
      closed_at: session.closed_at,
      resolution_note: session.resolution_note || 'No resolution note provided',
      issue_category: session.issue_category,
      issue_type: session.issue_type,
      issue_category_label: session.issue_category_label,
      issue_type_label: session.issue_type_label,
      rating: session.rating
    }));
    
    res.json({ sessions: formattedSessions });
  } catch (error) {
    console.error('[API Error] Failed to fetch agent history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Support Agent Backend Server',
    connections: {
      agents: connections.agents.size,
      customers: connections.customers.size
    }
  });
});

// Start server
const PORT = process.env.PORT || 8001;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🚀 Support Agent Backend Server Running                 ║
║  📡 Port: ${PORT}                                           ║
║  🔌 WebSocket: ws://localhost:${PORT}/ws/agent/{email}      ║
║  🔌 WebSocket: ws://localhost:${PORT}/ws/customer/{id}      ║
║  ✅ Database: PostgreSQL (Neon)                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  wss.clients.forEach(client => client.close());
  dbPG.pool.end(); // Close PostgreSQL connections
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
