const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors({
  origin: ['http://localhost:3004', 'http://localhost:3005', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/extrahand_support', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB Connected');
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

// MongoDB Schemas
const sessionSchema = new mongoose.Schema({
  customer_name: String,
  customer_email: { type: String, required: true, index: true },
  agent_email: { type: String, default: null },
  status: { type: String, enum: ['pending', 'active', 'closed'], default: 'pending', index: true },
  created_at: { type: Date, default: Date.now },
  closed_at: { type: Date, default: null }
});

const messageSchema = new mongoose.Schema({
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  content: { type: String, required: true },
  sender: { type: String, enum: ['customer', 'agent', 'system'], required: true },
  timestamp: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);
const Message = mongoose.model('Message', messageSchema);

// In-memory connection tracking
const connections = {
  agents: new Map(),      // email -> WebSocket
  customers: new Map()    // sessionId -> WebSocket
};

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  console.log('[WebSocket] New connection:', url.pathname);

  if (pathParts[0] === 'ws') {
    if (pathParts[1] === 'agent') {
      // Agent connection
      const agentEmail = pathParts[2];
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
      const sessionId = pathParts[2];
      
      // Prevent duplicate connections
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

      ws.on('close', () => {
        connections.customers.delete(sessionId);
        console.log(`[Customer] Disconnected: Session ${sessionId}`);
      });
    }
  }
});

// Handle agent messages
async function handleAgentMessage(agentEmail, message) {
  console.log(`[Agent ${agentEmail}] Message:`, message);

  switch (message.action) {
    case 'join_chat':
      await joinChat(agentEmail, message.session_id);
      break;
    case 'send_message':
      await sendMessageToCustomer(message.session_id, message.content, 'agent');
      break;
    case 'close_session':
      await closeSession(message.session_id, message.resolution_note);
      break;
  }
}

// Handle customer messages
async function handleCustomerMessage(sessionId, message) {
  console.log(`[Customer Session ${sessionId}] Message:`, message);

  if (message.action === 'send_message') {
    await sendMessageToAgent(sessionId, message.content, 'customer');
  }
}

// Join chat (agent accepts)
async function joinChat(agentEmail, sessionId) {
  try {
    const session = await Session.findById(sessionId);
    if (session && session.status !== 'closed') {
      session.agent_email = agentEmail;
      session.status = 'active';
      await session.save();

      // Notify agent
      const agentWs = connections.agents.get(agentEmail);
      if (agentWs) {
        sendDashboardUpdate(agentEmail);
        sendChatHistory(sessionId, agentWs);
      }

      // Notify customer
      const customerWs = connections.customers.get(sessionId);
      if (customerWs && customerWs.readyState === WebSocket.OPEN) {
        customerWs.send(JSON.stringify({
          type: 'agent_joined',
          message: 'An agent has joined the chat'
        }));
      }

      console.log(`[Chat] Agent ${agentEmail} joined session ${sessionId}`);
    }
  } catch (error) {
    console.error('[joinChat] Error:', error);
  }
}

// Send message to customer
async function sendMessageToCustomer(sessionId, content, sender) {
  try {
    // Save to database
    const message = new Message({
      session_id: sessionId,
      content,
      sender,
      timestamp: new Date()
    });
    await message.save();

    const messageData = {
      type: 'message',
      session_id: sessionId,
      content,
      sender,
      timestamp: message.timestamp.toISOString()
    };

    // Send to customer
    const customerWs = connections.customers.get(sessionId);
    if (customerWs && customerWs.readyState === WebSocket.OPEN) {
      customerWs.send(JSON.stringify(messageData));
    }

    // Send to agent
    const session = await Session.findById(sessionId);
    if (session && session.agent_email) {
      const agentWs = connections.agents.get(session.agent_email);
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify(messageData));
      }
    }

    console.log(`[Message] Sent to session ${sessionId}`);
  } catch (error) {
    console.error('[sendMessageToCustomer] Error:', error);
  }
}

// Send message to agent
async function sendMessageToAgent(sessionId, content, sender) {
  try {
    // Save to database
    const message = new Message({
      session_id: sessionId,
      content,
      sender,
      timestamp: new Date()
    });
    await message.save();

    const messageData = {
      type: 'message',
      session_id: sessionId,
      content,
      sender,
      timestamp: message.timestamp.toISOString()
    };

    // Send to agent
    const session = await Session.findById(sessionId);
    if (session && session.agent_email) {
      const agentWs = connections.agents.get(session.agent_email);
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify(messageData));
      }
    }

    // Send to customer (echo back)
    const customerWs = connections.customers.get(sessionId);
    if (customerWs && customerWs.readyState === WebSocket.OPEN) {
      customerWs.send(JSON.stringify(messageData));
    }

    console.log(`[Message] Sent from customer in session ${sessionId}`);
  } catch (error) {
    console.error('[sendMessageToAgent] Error:', error);
  }
}

// Close session
async function closeSession(sessionId, resolutionNote) {
  try {
    const session = await Session.findById(sessionId);
    if (session) {
      session.status = 'closed';
      session.closed_at = new Date();
      await session.save();

      const closeMessage = {
        type: 'session_closed',
        message: 'This chat has been resolved and closed.',
        resolution_note: resolutionNote
      };

      // Notify customer
      const customerWs = connections.customers.get(sessionId);
      if (customerWs && customerWs.readyState === WebSocket.OPEN) {
        customerWs.send(JSON.stringify(closeMessage));
      }

      // Notify agent
      if (session.agent_email) {
        const agentWs = connections.agents.get(session.agent_email);
        if (agentWs && agentWs.readyState === WebSocket.OPEN) {
          sendDashboardUpdate(session.agent_email);
        }
      }

      console.log(`[Session] Closed: ${sessionId}`);
    }
  } catch (error) {
    console.error('[closeSession] Error:', error);
  }
}

// Send chat history
async function sendChatHistory(sessionId, ws) {
  try {
    const messages = await Message.find({ session_id: sessionId }).sort({ timestamp: 1 });
    const session = await Session.findById(sessionId);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'history',
        session_id: sessionId,
        messages: messages.map(msg => ({
          content: msg.content,
          sender: msg.sender,
          timestamp: msg.timestamp.toISOString()
        }))
      }));
      
      // If session is already active, notify that agent has joined
      if (session && session.status === 'active' && session.agent_email) {
        ws.send(JSON.stringify({
          type: 'agent_joined',
          message: 'Agent has joined the chat',
          agent_email: session.agent_email
        }));
      }
    }
  } catch (error) {
    console.error('[sendChatHistory] Error:', error);
  }
}

// Send dashboard update to agent
async function sendDashboardUpdate(agentEmail) {
  try {
    const pending = await Session.find({ status: 'pending' });
    const active = await Session.find({ status: 'active', agent_email: agentEmail });

    const agentWs = connections.agents.get(agentEmail);
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({
        type: 'dashboard_update',
        pending_chats: pending.map(s => ({
          id: s._id.toString(),
          customer_name: s.customer_name,
          customer_email: s.customer_email,
          created_at: s.created_at.toISOString()
        })),
        active_chats: active.map(s => ({
          id: s._id.toString(),
          customer_name: s.customer_name,
          customer_email: s.customer_email,
          created_at: s.created_at.toISOString()
        }))
      }));
    }
  } catch (error) {
    console.error('[sendDashboardUpdate] Error:', error);
  }
}

// REST API Endpoints

// Create new chat session
app.post('/api/sessions', async (req, res) => {
  try {
    const { customer_name, customer_email } = req.body;
    
    // Check for existing OPEN session (pending or active)
    const existingSession = await Session.findOne({
      customer_email,
      status: { $in: ['pending', 'active'] }
    });
    
    if (existingSession) {
      console.log(`[Session] Returning existing session ${existingSession._id} for ${customer_email}`);
      return res.json({ session_id: existingSession._id.toString() });
    }
    
    // Create new session
    const newSession = new Session({
      customer_name,
      customer_email,
      status: 'pending'
    });
    
    await newSession.save();

    // Notify all connected agents about new pending chat
    connections.agents.forEach((ws, email) => {
      sendDashboardUpdate(email);
    });

    console.log(`[Session] Created new session ${newSession._id} for ${customer_email}`);
    res.json({ session_id: newSession._id.toString() });
  } catch (error) {
    console.error('[POST /api/sessions] Error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get session details
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (session) {
      res.json(session);
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Get quick replies
app.get('/api/agent/quick-replies', (req, res) => {
  res.json({
    replies: [
      "Hello! How can I assist you today?",
      "Thank you for contacting us. I'll help you with that.",
      "Could you please provide more details?",
      "I understand your concern. Let me look into this for you.",
      "Is there anything else I can help you with?"
    ]
  });
});

// Start server
const PORT = process.env.PORT || 8001;
server.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🚀 Support Agent Backend Server Running                 ║');
  console.log(`║  📡 Port: ${PORT}                                           ║`);
  console.log(`║  🔌 WebSocket: ws://localhost:${PORT}/ws/agent/{email}      ║`);
  console.log(`║  🔌 WebSocket: ws://localhost:${PORT}/ws/customer/{id}      ║`);
  console.log('║  ✅ MongoDB: Connected                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Close all WebSocket connections
  connections.agents.forEach(ws => ws.close());
  connections.customers.forEach(ws => ws.close());
  
  // Close MongoDB connection
  await mongoose.connection.close();
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
