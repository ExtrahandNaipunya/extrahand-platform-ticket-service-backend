"""
PostgreSQL Database Module for ExtraHand Support System
Migrated from SQLite to PostgreSQL (Neon DB)
"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool
import bcrypt
from datetime import datetime
from typing import Optional, List, Dict
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection pool
db_pool = None

def get_database_url():
    """Get database URL from environment"""
    return os.getenv('DATABASE_URL', 'postgresql://neondb_owner:npg_lvLP9RHM5Tgd@ep-orange-smoke-ahoerov4-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require')

def init_db_pool():
    """Initialize database connection pool"""
    global db_pool
    if db_pool is None:
        database_url = get_database_url()
        db_pool = SimpleConnectionPool(1, 20, database_url)
        print(f"✅ Database connection pool initialized")

def get_db_connection():
    """Get a connection from the pool"""
    if db_pool is None:
        init_db_pool()
    return db_pool.getconn()

def release_db_connection(conn):
    """Release connection back to the pool"""
    if db_pool:
        db_pool.putconn(conn)

def init_db():
    """Initialize database schema"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # Agents Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS agents (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE,
                phone VARCHAR(50),
                role VARCHAR(100) DEFAULT 'Support Agent',
                department VARCHAR(100),
                status VARCHAR(50) DEFAULT 'offline',
                profile_picture BYTEA,
                aadhar_number VARCHAR(20),
                aadhar_document BYTEA,
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                country VARCHAR(100) DEFAULT 'India',
                postal_code VARCHAR(20),
                date_of_birth DATE,
                joining_date DATE,
                employee_id VARCHAR(50) UNIQUE,
                emergency_contact_name VARCHAR(255),
                emergency_contact_phone VARCHAR(50),
                bank_account_number VARCHAR(50),
                bank_ifsc_code VARCHAR(20),
                pan_number VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Customers Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customers (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                company VARCHAR(255),
                profile_picture BYTEA,
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                country VARCHAR(100),
                postal_code VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Chat Sessions Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                customer_name VARCHAR(255),
                customer_email VARCHAR(255),
                agent_id INTEGER REFERENCES agents(id),
                status VARCHAR(50) DEFAULT 'pending',
                ticket_id VARCHAR(100) UNIQUE,
                priority VARCHAR(50) DEFAULT 'medium',
                category VARCHAR(100),
                issue_category VARCHAR(100),
                issue_type VARCHAR(100),
                issue_category_label VARCHAR(255),
                issue_type_label VARCHAR(255),
                subject VARCHAR(255),
                rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                feedback TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                closed_at TIMESTAMP,
                resolution_note TEXT,
                resolution_time INTEGER
            )
        ''')

        # Messages Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                sender_type VARCHAR(50) NOT NULL,
                sender_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_read BOOLEAN DEFAULT FALSE
            )
        ''')

        # Create indexes for better performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_customer ON chat_sessions(customer_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_agent ON chat_sessions(agent_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_status ON chat_sessions(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_ticket ON chat_sessions(ticket_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_agents_username ON agents(username)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_agents_email ON agents(email)')

        conn.commit()
        print("✅ PostgreSQL Database initialized: neondb")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error initializing database: {e}")
        raise
    finally:
        release_db_connection(conn)

# --- Auth Helpers ---
def get_password_hash(password):
    if isinstance(password, str):
        password = password.encode('utf-8')
    return bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password, hashed_password):
    if isinstance(plain_password, str):
        plain_password = plain_password.encode('utf-8')
    if isinstance(hashed_password, str):
        hashed_password = hashed_password.encode('utf-8')
    return bcrypt.checkpw(plain_password, hashed_password)

# --- Agent Operations ---
def create_agent(username, password, name):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        hashed = get_password_hash(password)
        cursor.execute(
            "INSERT INTO agents (username, password_hash, name) VALUES (%s, %s, %s) RETURNING id",
            (username, hashed, name)
        )
        agent_id = cursor.fetchone()[0]
        conn.commit()
        return agent_id
    except psycopg2.IntegrityError:
        conn.rollback()
        return None
    finally:
        release_db_connection(conn)

def get_agent_by_username(username):
    """Get agent by username or email"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM agents WHERE username = %s OR email = %s", (username, username))
        agent = cursor.fetchone()
        return dict(agent) if agent else None
    finally:
        release_db_connection(conn)

def get_agent_by_id(agent_id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM agents WHERE id = %s", (agent_id,))
        agent = cursor.fetchone()
        return dict(agent) if agent else None
    finally:
        release_db_connection(conn)

# --- Customer Operations ---
def create_customer(email, password, name):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        hashed = get_password_hash(password)
        cursor.execute(
            "INSERT INTO customers (email, password_hash, name) VALUES (%s, %s, %s) RETURNING id",
            (email, hashed, name)
        )
        customer_id = cursor.fetchone()[0]
        conn.commit()
        return customer_id
    except psycopg2.IntegrityError:
        conn.rollback()
        return None
    finally:
        release_db_connection(conn)

def get_customer_by_email(email):
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM customers WHERE email = %s", (email,))
        customer = cursor.fetchone()
        return dict(customer) if customer else None
    finally:
        release_db_connection(conn)

def get_or_create_customer_by_email(email, name):
    """Get existing customer or create new one"""
    customer = get_customer_by_email(email)
    if customer:
        return customer
    
    # Create new customer with a default password
    customer_id = create_customer(email, 'default_password_123', name)
    if customer_id:
        return get_customer_by_email(email)
    return None

# --- Session Operations ---
def create_session_with_email(customer_name: str, customer_email: str, 
                             issue_category: str = None, issue_type: str = None,
                             issue_category_label: str = None, issue_type_label: str = None):
    """Create a new chat session for a customer"""
    customer = get_or_create_customer_by_email(customer_email, customer_name)
    if not customer:
        raise Exception("Failed to create/get customer")
    
    customer_id = customer['id']
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Create session
        cursor.execute(
            """INSERT INTO chat_sessions (customer_id, customer_name, customer_email, status, 
               issue_category, issue_type, issue_category_label, issue_type_label, started_at) 
               VALUES (%s, %s, %s, 'pending', %s, %s, %s, %s, %s) RETURNING id""",
            (customer_id, customer_name, customer_email, issue_category, issue_type, 
             issue_category_label, issue_type_label, datetime.now())
        )
        session_id = cursor.fetchone()['id']
        
        # Generate ticket ID
        ticket_id = f"TICKET-{datetime.now().strftime('%Y%m%d')}-{session_id:04d}"
        
        # Update with ticket ID
        cursor.execute(
            "UPDATE chat_sessions SET ticket_id = %s WHERE id = %s",
            (ticket_id, session_id)
        )
        conn.commit()
        
        # Fetch the session
        cursor.execute('''
            SELECT s.*, c.name as customer_name, c.email as customer_email 
            FROM chat_sessions s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.id = %s
        ''', (session_id,))
        return dict(cursor.fetchone())
    except Exception as e:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)

def get_session_by_id(session_id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, c.name as customer_name, c.email as customer_email 
            FROM chat_sessions s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.id = %s
        ''', (session_id,))
        session = cursor.fetchone()
        return dict(session) if session else None
    finally:
        release_db_connection(conn)

def get_customer_active_session(customer_email: str):
    """Get customer's active or pending session"""
    customer = get_customer_by_email(customer_email)
    if not customer:
        return None
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, c.name as customer_name, c.email as customer_email 
            FROM chat_sessions s
            JOIN customers c ON s.customer_id = c.id
            WHERE c.email = %s AND s.status IN ('pending', 'active')
            ORDER BY s.created_at DESC
            LIMIT 1
        ''', (customer_email,))
        session = cursor.fetchone()
        return dict(session) if session else None
    finally:
        release_db_connection(conn)

def get_pending_sessions():
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, c.name as customer_name, c.email as customer_email
            FROM chat_sessions s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.status = 'pending'
            ORDER BY s.created_at ASC
        ''')
        sessions = []
        for row in cursor.fetchall():
            session = dict(row)
            # Convert datetime objects to ISO format strings
            if 'created_at' in session and session['created_at']:
                session['created_at'] = session['created_at'].isoformat()
            if 'started_at' in session and session['started_at']:
                session['started_at'] = session['started_at'].isoformat()
            if 'ended_at' in session and session['ended_at']:
                session['ended_at'] = session['ended_at'].isoformat()
            sessions.append(session)
        return sessions
    finally:
        release_db_connection(conn)

def get_agent_active_sessions(agent_id: int):
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, c.name as customer_name, c.email as customer_email
            FROM chat_sessions s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.agent_id = %s AND s.status = 'active'
            ORDER BY s.started_at DESC
        ''', (agent_id,))
        sessions = []
        for row in cursor.fetchall():
            session = dict(row)
            # Convert datetime objects to ISO format strings
            if 'created_at' in session and session['created_at']:
                session['created_at'] = session['created_at'].isoformat()
            if 'started_at' in session and session['started_at']:
                session['started_at'] = session['started_at'].isoformat()
            if 'ended_at' in session and session['ended_at']:
                session['ended_at'] = session['ended_at'].isoformat()
            sessions.append(session)
        return sessions
    finally:
        release_db_connection(conn)

def assign_agent_to_session(session_id, agent_id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE chat_sessions SET agent_id = %s, status = 'active', started_at = %s WHERE id = %s",
            (agent_id, datetime.now(), session_id)
        )
        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        return False
    finally:
        release_db_connection(conn)

def close_session(session_id, resolution_note=None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        closed_at = datetime.now()
        cursor.execute(
            "UPDATE chat_sessions SET status = 'closed', closed_at = %s, resolution_note = %s WHERE id = %s",
            (closed_at, resolution_note, session_id)
        )
        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        return False
    finally:
        release_db_connection(conn)

# --- Message Operations ---
def add_message(session_id, sender_type, sender_id, content):
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "INSERT INTO messages (session_id, sender_type, sender_id, content, timestamp) VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (session_id, sender_type, sender_id, content, datetime.now())
        )
        message = cursor.fetchone()
        conn.commit()
        return dict(message)
    except Exception as e:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)

def get_session_messages(session_id):
    """Get all messages for a session with sender names"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
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
            WHERE m.session_id = %s
            ORDER BY m.timestamp ASC
        ''', (session_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        release_db_connection(conn)

def get_session_history(session_id):
    """Get session history formatted for WebSocket transmission"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT 
                m.id,
                m.sender_type as sender,
                m.content,
                m.timestamp,
                m.is_read,
                CASE 
                    WHEN m.sender_type = 'agent' THEN a.name
                    WHEN m.sender_type = 'customer' THEN c.name
                    ELSE 'System'
                END as sender_name
            FROM messages m
            LEFT JOIN agents a ON m.sender_type = 'agent' AND m.sender_id = a.id
            LEFT JOIN customers c ON m.sender_type = 'customer' AND m.sender_id = c.id
            WHERE m.session_id = %s
            ORDER BY m.timestamp ASC
        ''', (session_id,))
        
        messages = []
        for row in cursor.fetchall():
            msg = dict(row)
            # Format timestamp for JSON serialization
            if msg['timestamp']:
                msg['timestamp'] = msg['timestamp'].isoformat()
            messages.append(msg)
        
        return messages
    finally:
        release_db_connection(conn)

# --- History Operations ---
def get_closed_sessions_by_email(customer_email: str):
    """Get all closed sessions for a customer by email"""
    customer = get_customer_by_email(customer_email)
    if not customer:
        return []
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, a.name as agent_name, c.name as customer_name, c.email as customer_email
            FROM chat_sessions s
            LEFT JOIN agents a ON s.agent_id = a.id
            JOIN customers c ON s.customer_id = c.id
            WHERE c.email = %s AND s.status = 'closed'
            ORDER BY s.closed_at DESC
        ''', (customer_email,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        release_db_connection(conn)

def get_agent_closed_sessions(agent_id: int):
    """Get all closed sessions for an agent"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, c.name as customer_name, c.email as customer_email
            FROM chat_sessions s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.agent_id = %s AND s.status = 'closed'
            ORDER BY s.closed_at DESC
        ''', (agent_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        release_db_connection(conn)

def get_customer_closed_sessions(customer_id):
    """Get customer's closed ticket history"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT s.*, a.name as agent_name,
                   (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
            FROM chat_sessions s
            LEFT JOIN agents a ON s.agent_id = a.id
            WHERE s.customer_id = %s AND s.status = 'closed'
            ORDER BY s.closed_at DESC
        ''', (customer_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        release_db_connection(conn)

# --- Analytics Operations ---
def get_agent_analytics(agent_id: int):
    """Get comprehensive analytics for an agent"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Total conversations (all statuses)
        cursor.execute('''
            SELECT COUNT(*) as total_conversations
            FROM chat_sessions
            WHERE agent_id = %s
        ''', (agent_id,))
        total_conversations = cursor.fetchone()['total_conversations']
        
        # Resolved successfully (closed sessions)
        cursor.execute('''
            SELECT COUNT(*) as resolved_count
            FROM chat_sessions
            WHERE agent_id = %s AND status = 'closed'
        ''', (agent_id,))
        resolved_count = cursor.fetchone()['resolved_count']
        
        # Active chats currently
        cursor.execute('''
            SELECT COUNT(*) as active_count
            FROM chat_sessions
            WHERE agent_id = %s AND status = 'active'
        ''', (agent_id,))
        active_count = cursor.fetchone()['active_count']
        
        # Handled today (sessions started today)
        cursor.execute('''
            SELECT COUNT(*) as handled_today
            FROM chat_sessions
            WHERE agent_id = %s 
            AND DATE(started_at) = CURRENT_DATE
        ''', (agent_id,))
        handled_today = cursor.fetchone()['handled_today']
        
        # Average response time (time from created to started)
        cursor.execute('''
            SELECT AVG(EXTRACT(EPOCH FROM (started_at - created_at))) as avg_response_seconds
            FROM chat_sessions
            WHERE agent_id = %s 
            AND status = 'closed'
            AND started_at IS NOT NULL
        ''', (agent_id,))
        result = cursor.fetchone()
        avg_response_seconds = result['avg_response_seconds'] if result['avg_response_seconds'] else 0
        
        # Average resolution time (time from started to closed)
        cursor.execute('''
            SELECT AVG(EXTRACT(EPOCH FROM (closed_at - started_at))) as avg_resolution_seconds
            FROM chat_sessions
            WHERE agent_id = %s 
            AND status = 'closed'
            AND started_at IS NOT NULL
            AND closed_at IS NOT NULL
        ''', (agent_id,))
        result = cursor.fetchone()
        avg_resolution_seconds = result['avg_resolution_seconds'] if result['avg_resolution_seconds'] else 0
        
        # Customer rating average
        cursor.execute('''
            SELECT AVG(rating) as avg_rating, COUNT(rating) as rating_count
            FROM chat_sessions
            WHERE agent_id = %s AND rating IS NOT NULL
        ''', (agent_id,))
        result = cursor.fetchone()
        avg_rating = float(result['avg_rating']) if result['avg_rating'] else 0.0
        rating_count = result['rating_count']
        
        # Total hours this month
        cursor.execute('''
            SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - started_at))) as total_seconds
            FROM chat_sessions
            WHERE agent_id = %s 
            AND started_at IS NOT NULL
            AND DATE_TRUNC('month', started_at) = DATE_TRUNC('month', CURRENT_DATE)
        ''', (agent_id,))
        result = cursor.fetchone()
        total_seconds = result['total_seconds'] if result['total_seconds'] else 0
        total_hours = int(total_seconds / 3600) if total_seconds else 0
        
        return {
            'total_conversations': total_conversations,
            'resolved_count': resolved_count,
            'active_count': active_count,
            'handled_today': handled_today,
            'avg_response_seconds': avg_response_seconds,
            'avg_resolution_seconds': avg_resolution_seconds,
            'avg_rating': round(avg_rating, 1),
            'rating_count': rating_count,
            'total_hours_month': total_hours
        }
    finally:
        release_db_connection(conn)

def get_agent_weekly_stats(agent_id: int):
    """Get day-by-day stats for the past 7 days"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('''
            SELECT 
                TO_CHAR(DATE(created_at), 'Dy') as day_name,
                DATE(created_at) as date,
                COUNT(*) as total_chats,
                COUNT(CASE WHEN status = 'closed' THEN 1 END) as resolved_chats
            FROM chat_sessions
            WHERE agent_id = %s
            AND created_at >= CURRENT_DATE - INTERVAL '6 days'
            GROUP BY DATE(created_at)
            ORDER BY DATE(created_at) ASC
        ''', (agent_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        release_db_connection(conn)

def get_agent_daily_activity(agent_id: int):
    """Get today's activity breakdown"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Active chats right now
        cursor.execute('''
            SELECT COUNT(*) as active_now
            FROM chat_sessions
            WHERE agent_id = %s AND status = 'active'
        ''', (agent_id,))
        active_now = cursor.fetchone()['active_now']
        
        # Handled today
        cursor.execute('''
            SELECT COUNT(*) as handled_today
            FROM chat_sessions
            WHERE agent_id = %s 
            AND DATE(started_at) = CURRENT_DATE
        ''', (agent_id,))
        handled_today = cursor.fetchone()['handled_today']
        
        # Hours today
        cursor.execute('''
            SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - started_at))) as total_seconds
            FROM chat_sessions
            WHERE agent_id = %s 
            AND started_at IS NOT NULL
            AND DATE(started_at) = CURRENT_DATE
        ''', (agent_id,))
        result = cursor.fetchone()
        total_seconds = result['total_seconds'] if result['total_seconds'] else 0
        hours_today = round(total_seconds / 3600, 1) if total_seconds else 0
        
        return {
            'active_now': active_now,
            'handled_today': handled_today,
            'hours_today': hours_today
        }
    finally:
        release_db_connection(conn)
