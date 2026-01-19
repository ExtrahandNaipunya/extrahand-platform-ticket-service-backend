"""
ExtraHand Support Agent Backend Server
Handles WebSocket connections for live chat between customers and agents
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import os
import json
import psycopg2.extras
from datetime import datetime
from contextlib import asynccontextmanager
import database as db

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup"""
    try:
        # Initialize Database
        db.init_db()
        # Create default agent
        db.create_agent("admin", "password123", "Ajay (Support Lead)")
        print("✅ Support Agent Backend initialized successfully")
    except Exception as e:
        print(f"⚠️ Warning during initialization: {e}")
    yield
    print("Shutting down Support Agent Backend")

app = FastAPI(title="ExtraHand Support Agent Backend", lifespan=lifespan)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3004", "http://localhost:3000", "http://localhost:3005"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class AgentLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class CloseSessionRequest(BaseModel):
    resolution_note: Optional[str] = None

class FeedbackRequest(BaseModel):
    rating: int
    feedback: Optional[str] = None

class CreateSessionRequest(BaseModel):
    customer_name: str
    customer_email: str
    issue_category: Optional[str] = None
    issue_type: Optional[str] = None
    issue_category_label: Optional[str] = None
    issue_type_label: Optional[str] = None

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_sessions: Dict[int, Dict] = {}
        self.agent_dashboards: Dict[int, WebSocket] = {}

    async def connect_customer(self, websocket: WebSocket, customer_id: int):
        await websocket.accept()
        session = db.create_session(customer_id, f"Customer {customer_id}", f"customer{customer_id}@example.com")
        session_id = session['id']
        
        if session_id not in self.active_sessions:
            self.active_sessions[session_id] = {}
        self.active_sessions[session_id]['customer'] = websocket
        
        print(f"[INFO] Customer {customer_id} connected, session {session_id}")
        await self.broadcast_pending_chats()
        return session_id

    async def connect_agent_dashboard(self, websocket: WebSocket, identifier: str):
        print(f"[INFO] 🔌 Agent dashboard connection attempt with identifier: '{identifier}'")
        await websocket.accept()
        
        # Try to find agent by username first, then by email (for compatibility)
        agent = db.get_agent_by_username(identifier)
        if not agent:
            # Try finding by checking all agents (in case identifier is email-like)
            # For now, just return error
            print(f"[ERROR] ❌ Agent not found with identifier: '{identifier}'")
            print(f"[DEBUG] Available agents query result: {agent}")
            await websocket.send_json({"type": "error", "message": f"Agent not found: {identifier}"})
            await websocket.close()
            return None
        
        agent_id = agent['id']
        self.agent_dashboards[agent_id] = websocket
        
        print(f"[INFO] Agent {identifier} (ID: {agent_id}) connected to dashboard")
        
        # Send initial dashboard data
        pending = db.get_pending_sessions()
        active = db.get_agent_active_sessions(agent_id)
        
        print(f"[DEBUG] Sending dashboard_update: {len(pending)} pending, {len(active)} active")
        
        await websocket.send_json({
            "type": "dashboard_update",
            "pending": pending,
            "active": active
        })
        
        return agent_id

    async def join_chat(self, agent_id: int, session_id: int):
        db.assign_agent_to_session(session_id, agent_id)
        
        # Get agent details
        agent = db.get_agent_by_id(agent_id)
        agent_name = dict(agent)['name'] if agent else "An agent"
        
        # Send chat history to agent
        history = db.get_session_history(session_id)
        if agent_id in self.agent_dashboards:
            await self.agent_dashboards[agent_id].send_json({
                "type": "history",
                "session_id": session_id,
                "messages": history
            })
        
        # Notify customer that agent joined with agent name
        if session_id in self.active_sessions and 'customer' in self.active_sessions[session_id]:
            await self.active_sessions[session_id]['customer'].send_json({
                "type": "agent_joined",
                "message": f"{agent_name} has joined the chat. How can we help you today?",
                "agent_name": agent_name
            })
        
        # Update all agent dashboards
        await self.broadcast_dashboard_updates(agent_id)
        print(f"[INFO] Agent {agent_id} joined session {session_id}")

    async def handle_message(self, session_id: int, sender_type: str, sender_id: int, content: str):
        """Handle and broadcast messages, storing them in the database"""
        print(f"[INFO] 💬 Handling message: session={session_id}, sender={sender_type}, content_preview={content[:50]}...")
        
        # Save message to database
        try:
            msg = db.add_message(session_id, sender_type, sender_id, content)
            print(f"[INFO] ✅ Message saved to database with ID: {msg['id']}")
        except Exception as e:
            print(f"[ERROR] ❌ Failed to save message to database: {e}")
            import traceback
            traceback.print_exc()
            return
        
        # Format timestamp for transmission
        timestamp = msg['timestamp']
        if isinstance(timestamp, datetime):
            timestamp = timestamp.isoformat()
        
        message_data = {
            "type": "message",
            "sender": sender_type,
            "content": content,
            "timestamp": timestamp,
            "message_id": msg['id']
        }
        
        # Broadcast to customer
        if session_id in self.active_sessions and 'customer' in self.active_sessions[session_id]:
            try:
                await self.active_sessions[session_id]['customer'].send_json(message_data)
                print(f"[INFO] 📤 Message sent to customer")
            except Exception as e:
                print(f"[ERROR] Failed to send to customer: {e}")
        
        # Broadcast to agent
        if session_id in self.active_sessions and 'agent' in self.active_sessions[session_id]:
            try:
                await self.active_sessions[session_id]['agent'].send_json(message_data)
                print(f"[INFO] 📤 Message sent to agent")
            except Exception as e:
                print(f"[ERROR] Failed to send to agent: {e}")
        
        # Broadcast to agent dashboard
        session = db.get_session_by_id(session_id)
        if session and session.get('agent_id'):
            agent_id = session['agent_id']
            if agent_id in self.agent_dashboards:
                agent_ws = self.agent_dashboards[agent_id]
                try:
                    await agent_ws.send_json({
                        "type": "message",
                        "session_id": session_id,
                        "sender": sender_type,
                        "content": content,
                        "timestamp": timestamp
                    })
                except Exception as e:
                    print(f"[ERROR] Failed to broadcast to agent {agent_id}: {e}")

    async def broadcast_pending_chats(self):
        """Broadcast pending chats to all connected agents"""
        pending = db.get_pending_sessions()
        print(f"[INFO] Broadcasting {len(pending)} pending chats to {len(self.agent_dashboards)} agents")
        for agent_id, ws in self.agent_dashboards.items():
            try:
                active = db.get_agent_active_sessions(agent_id)
                await ws.send_json({
                    "type": "dashboard_update",
                    "pending": pending,
                    "active": active
                })
                print(f"[INFO] Sent dashboard update to agent {agent_id}")
            except Exception as e:
                print(f"[ERROR] Failed to broadcast to agent {agent_id}: {e}")

    async def broadcast_dashboard_updates(self, agent_id: int):
        if agent_id in self.agent_dashboards:
            pending = db.get_pending_sessions()
            active = db.get_agent_active_sessions(agent_id)
            try:
                await self.agent_dashboards[agent_id].send_json({
                    "type": "dashboard_update",
                    "pending": pending,
                    "active": active
                })
            except:
                pass

manager = ConnectionManager()

# Health check
@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "ExtraHand Support Agent Backend"
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "active_sessions": len(manager.active_sessions),
        "active_agents": len(manager.agent_dashboards)
    }

# Agent Authentication
@app.post("/api/agent/login", response_model=Token)
async def agent_login(credentials: AgentLogin):
    agent = db.verify_agent(credentials.username, credentials.password)
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    return {
        "access_token": f"agent_token_{agent['id']}",
        "token_type": "bearer"
    }

# Session Management
@app.post("/api/sessions")
async def create_session(request: CreateSessionRequest):
    """Create a new chat session for a customer"""
    # Check if customer already has an active session
    existing_session = db.get_customer_active_session(request.customer_email)
    if existing_session:
        return {"session_id": existing_session['id'], "status": "existing"}
    
    # Create new session with issue information
    session = db.create_session_with_email(
        request.customer_name, 
        request.customer_email,
        request.issue_category,
        request.issue_type,
        request.issue_category_label,
        request.issue_type_label
    )
    
    print(f"[INFO] Created new session {session['id']} for customer {request.customer_email}")
    print(f"[INFO] Issue: {request.issue_category_label} - {request.issue_type_label}")
    print(f"[INFO] Currently {len(manager.agent_dashboards)} agents connected")
    
    # Notify all agents about new pending chat
    await manager.broadcast_pending_chats()
    
    return {"session_id": session['id'], "status": "created"}

@app.get("/api/customer/can-chat/{customer_email}")
async def can_customer_chat(customer_email: str):
    """Check if customer can start a new chat or has an active session"""
    active_session = db.get_customer_active_session(customer_email)
    if active_session:
        return {
            "can_chat": False,
            "active_session_id": active_session['id'],
            "message": "You have an active chat session"
        }
    return {
        "can_chat": True,
        "active_session_id": None,
        "message": "You can start a new chat"
    }

@app.get("/api/sessions/pending")
async def get_pending_sessions():
    return {"sessions": db.get_pending_sessions()}

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: int):
    session = db.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@app.get("/api/customer/history/{customer_email}")
async def get_customer_history(customer_email: str):
    """Get all closed tickets/sessions for a customer"""
    try:
        print(f"[INFO] Fetching history for customer: {customer_email}")
        
        # Check if customer exists
        customer = db.get_customer_by_email(customer_email)
        if not customer:
            print(f"[WARNING] Customer not found in database: {customer_email}")
            return {"sessions": [], "message": "Customer not found"}
        
        print(f"[INFO] Found customer ID: {customer['id']}")
        closed_sessions = db.get_closed_sessions_by_email(customer_email)
        print(f"[INFO] Found {len(closed_sessions)} closed sessions")
        
        return {"sessions": closed_sessions}
    except Exception as e:
        print(f"[ERROR] Failed to get customer history: {e}")
        import traceback
        traceback.print_exc()
        return {"sessions": [], "error": str(e)}

@app.get("/api/agent/history/{agent_username}")
async def get_agent_history(agent_username: str):
    """Get all closed tickets/sessions for an agent"""
    try:
        agent = db.get_agent_by_username(agent_username)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        closed_sessions = db.get_agent_closed_sessions(agent['id'])
        return {"sessions": closed_sessions}
    except Exception as e:
        print(f"[ERROR] Failed to get agent history: {e}")
        return {"sessions": []}

# ============= AGENT PROFILE MANAGEMENT APIs =============

@app.get("/api/agent/profile/{agent_id}")
async def get_agent_profile(agent_id: int):
    """Get agent full profile"""
    try:
        from database_extensions import get_agent_full_profile
        profile = get_agent_full_profile(agent_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Agent not found")
        return profile
    except Exception as e:
        print(f"[ERROR] Failed to get agent profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/agent/profile/{agent_id}")
async def update_agent_profile(agent_id: int, profile_data: dict):
    """Update agent profile"""
    try:
        from database_extensions import update_agent_profile
        success = update_agent_profile(agent_id, profile_data)
        return {"success": success, "message": "Profile updated successfully"}
    except Exception as e:
        print(f"[ERROR] Failed to update agent profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/statistics/{agent_id}")
async def get_agent_stats(agent_id: int):
    """Get agent statistics"""
    try:
        from database_extensions import get_agent_statistics
        stats = get_agent_statistics(agent_id)
        return stats
    except Exception as e:
        print(f"[ERROR] Failed to get agent statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/stats/{agent_username}")
async def get_agent_stats_by_username(agent_username: str):
    """Get real-time agent statistics by username"""
    try:
        # Get agent by username
        agent = db.get_agent_by_username(agent_username)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        agent_id = agent['id']
        
        # Get comprehensive analytics from database
        analytics = db.get_agent_analytics(agent_id)
        
        # Format response time (seconds to readable format)
        avg_response_seconds = analytics['avg_response_seconds']
        if avg_response_seconds < 60:
            response_time = f"{int(avg_response_seconds)}s"
        else:
            minutes = int(avg_response_seconds / 60)
            seconds = int(avg_response_seconds % 60)
            response_time = f"{minutes}m {seconds}s"
        
        # Format resolution time
        avg_resolution_seconds = analytics['avg_resolution_seconds']
        if avg_resolution_seconds < 60:
            resolution_time = f"{int(avg_resolution_seconds)}s"
        else:
            minutes = int(avg_resolution_seconds / 60)
            seconds = int(avg_resolution_seconds % 60)
            resolution_time = f"{minutes}m {seconds}s"
        
        return {
            "total_conversations": analytics['total_conversations'],
            "resolved_count": analytics['resolved_count'],
            "resolution_rate": round((analytics['resolved_count'] / analytics['total_conversations'] * 100) if analytics['total_conversations'] > 0 else 0, 1),
            "active_count": analytics['active_count'],
            "handled_today": analytics['handled_today'],
            "avg_response_time": response_time,
            "avg_response_seconds": avg_response_seconds,
            "avg_resolution_time": resolution_time,
            "avg_resolution_seconds": avg_resolution_seconds,
            "avg_rating": analytics['avg_rating'],
            "rating_count": analytics['rating_count'],
            "total_hours_month": analytics['total_hours_month']
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Failed to get agent statistics: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/weekly-stats/{agent_username}")
async def get_agent_weekly_stats(agent_username: str):
    """Get agent's weekly performance statistics"""
    try:
        agent = db.get_agent_by_username(agent_username)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        agent_id = agent['id']
        weekly_stats = db.get_agent_weekly_stats(agent_id)
        
        # Convert date objects to strings for JSON serialization
        for stat in weekly_stats:
            if stat.get('date'):
                stat['date'] = stat['date'].isoformat()
        
        return {"weekly_stats": weekly_stats}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Failed to get weekly stats: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/daily-activity/{agent_username}")
async def get_agent_daily_activity(agent_username: str):
    """Get agent's today activity"""
    try:
        agent = db.get_agent_by_username(agent_username)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        agent_id = agent['id']
        daily_activity = db.get_agent_daily_activity(agent_id)
        
        return daily_activity
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Failed to get daily activity: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/documents/{agent_id}")
async def get_agent_docs(agent_id: int):
    """Get all agent documents (metadata only)"""
    try:
        from database_extensions import get_agent_documents
        docs = get_agent_documents(agent_id)
        return {"documents": docs}
    except Exception as e:
        print(f"[ERROR] Failed to get agent documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============= TICKET HISTORY APIs =============

@app.get("/api/ticket/history/{ticket_id}")
async def get_ticket_by_id(ticket_id: str):
    """Get complete ticket details and messages"""
    try:
        # Get ticket from chat_sessions table
        conn = db.get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        cursor.execute('''
            SELECT cs.*, c.name as customer_name, c.email as customer_email, 
                   a.name as agent_name
            FROM chat_sessions cs
            LEFT JOIN customers c ON cs.customer_id = c.id
            LEFT JOIN agents a ON cs.agent_id = a.id
            WHERE cs.ticket_id = %s AND cs.status = 'closed'
        ''', (ticket_id,))
        
        ticket = cursor.fetchone()
        if not ticket:
            db.release_db_connection(conn)
            raise HTTPException(status_code=404, detail="Ticket not found")
        
        ticket_dict = dict(ticket)
        session_id = ticket_dict['id']
        
        # Get messages for this session dynamically from database
        messages = db.get_session_messages(session_id)
        db.release_db_connection(conn)
        
        # Format timestamps
        for msg in messages:
            if msg.get('timestamp') and isinstance(msg['timestamp'], datetime):
                msg['timestamp'] = msg['timestamp'].isoformat()
        
        ticket_dict['messages'] = messages
        return ticket_dict
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Failed to get ticket: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/customer/ticket-history/{customer_email}")
async def get_customer_tickets(customer_email: str, limit: int = 50):
    """Get customer's complete ticket history"""
    try:
        from database_extensions import get_customer_ticket_history
        tickets = get_customer_ticket_history(customer_email, limit)
        return {"tickets": tickets, "total": len(tickets)}
    except Exception as e:
        print(f"[ERROR] Failed to get customer ticket history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/ticket-history/{agent_id}")
async def get_agent_tickets(agent_id: int, limit: int = 50):
    """Get agent's complete ticket history"""
    try:
        from database_extensions import get_agent_ticket_history
        tickets = get_agent_ticket_history(agent_id, limit)
        return {"tickets": tickets, "total": len(tickets)}
    except Exception as e:
        print(f"[ERROR] Failed to get agent ticket history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/customer/statistics/{customer_email}")
async def get_customer_stats(customer_email: str):
    """Get customer statistics"""
    try:
        from database_extensions import get_customer_statistics
        stats = get_customer_statistics(customer_email)
        return stats
    except Exception as e:
        print(f"[ERROR] Failed to get customer statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sessions/{session_id}/close")
async def close_session(session_id: int, request: CloseSessionRequest):
    # Get agent info before closing
    session = db.get_session_by_id(session_id)
    agent_name = "The agent"
    if session and session.get('agent_id'):
        agent = db.get_agent_by_id(session.get('agent_id'))
        agent_name = dict(agent)['name'] if agent else "The agent"
    
    db.close_session(session_id, request.resolution_note)
    
    # Notify customer with graceful closing message
    if session_id in manager.active_sessions and 'customer' in manager.active_sessions[session_id]:
        try:
            await manager.active_sessions[session_id]['customer'].send_json({
                "type": "session_closed",
                "message": f"{agent_name} has closed this chat. If you still have any issues or questions, please feel free to reach us again. Thank you for contacting ExtraHand Support!",
                "agent_name": agent_name
            })
        except:
            pass
    
    # Remove from active sessions
    if session_id in manager.active_sessions:
        del manager.active_sessions[session_id]
    
    return {"status": "success", "message": "Session closed"}

@app.post("/api/sessions/{session_id}/feedback")
async def submit_feedback(session_id: int, request: FeedbackRequest):
    """Submit customer feedback and rating for a closed session"""
    try:
        # Validate rating
        if request.rating < 1 or request.rating > 5:
            raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
        
        # Update session with feedback
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE chat_sessions 
            SET rating = ?, feedback = ?
            WHERE id = ?
        ''', (request.rating, request.feedback, session_id))
        conn.commit()
        conn.close()
        
        print(f"[INFO] Feedback submitted for session {session_id}: {request.rating} stars")
        return {"status": "success", "message": "Thank you for your feedback!"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Failed to submit feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/quick-replies")
async def get_quick_replies():
    return {
        "quick_replies": [
            {"id": 1, "category": "greeting", "text": "Hello! How can I assist you today?", "icon": "👋"},
            {"id": 2, "category": "payment", "text": "Let me check your payment details for you.", "icon": "💳"},
            {"id": 3, "category": "account", "text": "I'll help you with your account settings.", "icon": "⚙️"},
            {"id": 4, "category": "thank", "text": "Thank you for contacting ExtraHand support!", "icon": "🙏"},
        ]
    }

# WebSocket Endpoints
@app.websocket("/ws/customer/{session_id}")
async def customer_websocket(websocket: WebSocket, session_id: int):
    print(f"[INFO] 🔌 WebSocket connection attempt for session {session_id}")
    await websocket.accept()
    print(f"[INFO] ✅ WebSocket accepted for session {session_id}")
    
    # Get session details
    session = db.get_session_by_id(session_id)
    if not session:
        print(f"[ERROR] ❌ Session {session_id} not found in database")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    print(f"[INFO] 📋 Session {session_id} found: {session.get('customer_email')}")
    
    # Add customer to active sessions
    if session_id not in manager.active_sessions:
        manager.active_sessions[session_id] = {}
    manager.active_sessions[session_id]['customer'] = websocket
    
    print(f"[INFO] 👤 Customer connected to session {session_id}")
    
    # Send chat history
    history = db.get_session_history(session_id)
    print(f"[INFO] 📜 Sending {len(history)} history messages to customer")
    await websocket.send_json({
        "type": "history",
        "messages": history,
        "session": session
    })
    
    # If agent already joined, notify customer
    if session.get('status') == 'active' and session.get('agent_id'):
        agent = db.get_agent_by_id(session.get('agent_id'))
        agent_name = dict(agent)['name'] if agent else "An agent"
        await websocket.send_json({
            "type": "agent_joined",
            "message": f"{agent_name} is already connected and ready to help!",
            "agent_name": agent_name
        })
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get('action', data.get('type'))
            
            if action == 'send_message':
                content = data.get('content', '')
                if content:
                    # Use customer_id instead of email for sender_id
                    await manager.handle_message(session_id, 'customer', session['customer_id'], content)
                    
    except WebSocketDisconnect:
        print(f"[INFO] 👋 Customer disconnected from session {session_id}")
        if session_id in manager.active_sessions:
            if 'customer' in manager.active_sessions[session_id]:
                del manager.active_sessions[session_id]['customer']
    except Exception as e:
        print(f"[ERROR] 🔴 WebSocket error for session {session_id}: {e}")
        import traceback
        traceback.print_exc()
        if session_id in manager.active_sessions:
            if 'customer' in manager.active_sessions[session_id]:
                del manager.active_sessions[session_id]['customer']

@app.websocket("/ws/agent/{username}")
async def agent_websocket(websocket: WebSocket, username: str):
    agent_id = await manager.connect_agent_dashboard(websocket, username)
    if not agent_id:
        return
        
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get('action', data.get('type'))
            
            if action == 'join_chat':
                await manager.join_chat(agent_id, data['session_id'])
                if data['session_id'] not in manager.active_sessions:
                    manager.active_sessions[data['session_id']] = {}
                manager.active_sessions[data['session_id']]['agent'] = websocket
                
            elif action == 'open_chat':
                # Send chat history when agent opens an active chat
                session_id = data['session_id']
                history = db.get_session_history(session_id)
                await websocket.send_json({
                    "type": "history",
                    "session_id": session_id,
                    "messages": history
                })
                print(f"[INFO] Sent history for session {session_id} to agent {agent_id}")
                
            elif action == 'send_message':
                session_id = data.get('session_id')
                content = data.get('content', '')
                if session_id and content:
                    await manager.handle_message(session_id, 'agent', agent_id, content)
                
    except WebSocketDisconnect:
        if agent_id in manager.agent_dashboards:
            del manager.agent_dashboards[agent_id]

@app.get("/api/test/agent/{identifier}")
async def test_agent_lookup(identifier: str):
    """Test endpoint to verify agent lookup by username or email"""
    agent = db.get_agent_by_username(identifier)
    if agent:
        return {
            "found": True,
            "agent": {
                "id": agent['id'],
                "username": agent['username'],
                "email": agent['email'],
                "name": agent['name']
            }
        }
    else:
        return {"found": False, "identifier": identifier}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
