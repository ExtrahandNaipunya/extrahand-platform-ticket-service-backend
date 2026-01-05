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
        await websocket.accept()
        
        # Try to find agent by username first, then by email (for compatibility)
        agent = db.get_agent_by_username(identifier)
        if not agent:
            # Try finding by checking all agents (in case identifier is email-like)
            # For now, just return error
            print(f"[ERROR] Agent not found with identifier: {identifier}")
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
        # Save message to database (database automatically adds UTC timestamp)
        msg = db.add_message(session_id, sender_type, sender_id, content)
        
        # Ensure timestamp is in ISO format with Z suffix for UTC
        timestamp = msg['timestamp']
        if not timestamp.endswith('Z'):
            timestamp = timestamp.replace(' ', 'T') + 'Z'
        
        # Broadcast to customer
        if session_id in self.active_sessions and 'customer' in self.active_sessions[session_id]:
            try:
                await self.active_sessions[session_id]['customer'].send_json({
                    "type": "message",
                    "sender": sender_type,
                    "content": content,
                    "timestamp": timestamp
                })
            except Exception as e:
                print(f"[ERROR] Failed to send to customer: {e}")
        
        # Broadcast to agent
        if session_id in self.active_sessions and 'agent' in self.active_sessions[session_id]:
            try:
                await self.active_sessions[session_id]['agent'].send_json({
                    "type": "message",
                    "sender": sender_type,
                    "content": content,
                    "timestamp": timestamp
                })
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
        pending = db.get_pending_sessions()
        for ws in self.agent_dashboards.values():
            try:
                await ws.send_json({"type": "pending_chats", "data": pending})
            except:
                pass

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
        conn = db.get_db_connection()
        cursor = conn.cursor()
        
        # Count closed sessions
        cursor.execute('SELECT COUNT(*) as count FROM chat_sessions WHERE agent_id = ? AND status = "closed"', (agent_id,))
        closed_count = cursor.fetchone()['count']
        
        # Count active sessions
        cursor.execute('SELECT COUNT(*) as count FROM chat_sessions WHERE agent_id = ? AND status = "active"', (agent_id,))
        active_count = cursor.fetchone()['count']
        
        # Count pending sessions assigned to agent
        cursor.execute('SELECT COUNT(*) as count FROM chat_sessions WHERE agent_id = ? AND status = "pending"', (agent_id,))
        pending_count = cursor.fetchone()['count']
        
        # Calculate average rating (from closed sessions)
        cursor.execute('SELECT AVG(rating) as avg_rating FROM chat_sessions WHERE agent_id = ? AND rating IS NOT NULL', (agent_id,))
        result = cursor.fetchone()
        avg_rating = round(result['avg_rating'], 1) if result['avg_rating'] else 0
        
        # Calculate average response time
        cursor.execute('''
            SELECT AVG(
                (julianday(closed_at) - julianday(started_at)) * 24 * 60
            ) as avg_time
            FROM chat_sessions 
            WHERE agent_id = ? AND status = "closed" AND started_at IS NOT NULL AND closed_at IS NOT NULL
        ''', (agent_id,))
        result = cursor.fetchone()
        avg_time = result['avg_time'] if result['avg_time'] else 0
        
        # Format response time
        if avg_time < 1:
            response_time = f"{int(avg_time * 60)}s"
        elif avg_time < 60:
            response_time = f"{int(avg_time)}m {int((avg_time % 1) * 60)}s"
        else:
            hours = int(avg_time / 60)
            minutes = int(avg_time % 60)
            response_time = f"{hours}h {minutes}m"
        
        # Calculate total online hours (sum of session durations)
        cursor.execute('''
            SELECT SUM(
                (julianday(COALESCE(closed_at, CURRENT_TIMESTAMP)) - julianday(created_at)) * 24
            ) as total_hours
            FROM chat_sessions 
            WHERE agent_id = ?
        ''', (agent_id,))
        result = cursor.fetchone()
        total_hours = result['total_hours'] if result['total_hours'] else 0
        online_hours = f"{int(total_hours)}h"
        
        conn.close()
        
        return {
            "closed_count": closed_count,
            "active_count": active_count,
            "pending_count": pending_count,
            "average_rating": avg_rating,
            "avg_response_time": response_time,
            "online_hours": online_hours
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Failed to get agent statistics: {e}")
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
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT cs.*, c.name as customer_name, c.email as customer_email, 
                   a.name as agent_name
            FROM chat_sessions cs
            LEFT JOIN customers c ON cs.customer_id = c.id
            LEFT JOIN agents a ON cs.agent_id = a.id
            WHERE cs.ticket_id = ? AND cs.status = 'closed'
        ''', (ticket_id,))
        
        ticket = cursor.fetchone()
        if not ticket:
            conn.close()
            raise HTTPException(status_code=404, detail="Ticket not found")
        
        ticket_dict = dict(ticket)
        session_id = ticket_dict['id']
        
        # Get messages for this session
        cursor.execute('''
            SELECT m.*, 
                   CASE 
                       WHEN m.sender_type = 'agent' THEN a.name
                       WHEN m.sender_type = 'customer' THEN c.name
                       ELSE 'System'
                   END as sender_name
            FROM messages m
            LEFT JOIN agents a ON m.sender_type = 'agent' AND m.sender_id = a.id
            LEFT JOIN customers c ON m.sender_type = 'customer' AND m.sender_id = c.id
            WHERE m.session_id = ?
            ORDER BY m.timestamp ASC
        ''', (session_id,))
        
        messages = cursor.fetchall()
        conn.close()
        
        ticket_dict['messages'] = [dict(m) for m in messages]
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
    await websocket.accept()
    
    # Get session details
    session = db.get_session_by_id(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    # Add customer to active sessions
    if session_id not in manager.active_sessions:
        manager.active_sessions[session_id] = {}
    manager.active_sessions[session_id]['customer'] = websocket
    
    print(f"[INFO] Customer connected to session {session_id}")
    
    # Send chat history
    history = db.get_session_history(session_id)
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
        print(f"[INFO] Customer disconnected from session {session_id}")
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
