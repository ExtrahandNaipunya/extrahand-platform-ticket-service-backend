import sqlite3
import os
import bcrypt
import json
from datetime import datetime
from typing import Optional, List, Dict

DB_NAME = "support_system.db"

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Agents Table - Enhanced with profile data
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            phone TEXT,
            role TEXT DEFAULT 'Support Agent',
            department TEXT,
            status TEXT DEFAULT 'offline',
            profile_picture BLOB,
            aadhar_number TEXT,
            aadhar_document BLOB,
            address TEXT,
            city TEXT,
            state TEXT,
            country TEXT DEFAULT 'India',
            postal_code TEXT,
            date_of_birth DATE,
            joining_date DATE,
            employee_id TEXT UNIQUE,
            emergency_contact_name TEXT,
            emergency_contact_phone TEXT,
            bank_account_number TEXT,
            bank_ifsc_code TEXT,
            pan_number TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Customers Table - Enhanced with profile data
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            phone TEXT,
            company TEXT,
            profile_picture BLOB,
            address TEXT,
            city TEXT,
            state TEXT,
            country TEXT,
            postal_code TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Chat Sessions Table - Enhanced with more metadata
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            agent_id INTEGER,
            status TEXT DEFAULT 'pending', -- pending, active, closed
            ticket_id TEXT UNIQUE,
            priority TEXT DEFAULT 'medium', -- low, medium, high, urgent
            category TEXT,
            subject TEXT,
            rating INTEGER, -- 1-5 customer rating
            feedback TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            closed_at TIMESTAMP,
            resolution_note TEXT,
            resolution_time INTEGER, -- Time in seconds to resolve
            FOREIGN KEY (customer_id) REFERENCES customers (id),
            FOREIGN KEY (agent_id) REFERENCES agents (id)
        )
    ''')

    # Messages Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            sender_type TEXT NOT NULL, -- customer, agent, system
            sender_id INTEGER, -- ID of customer or agent
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
        )
    ''')

    # Ticket History Table - Comprehensive ticket tracking
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ticket_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id TEXT NOT NULL,
            session_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            agent_id INTEGER,
            agent_name TEXT,
            status TEXT NOT NULL,
            priority TEXT,
            category TEXT,
            subject TEXT,
            total_messages INTEGER DEFAULT 0,
            resolution_note TEXT,
            rating INTEGER,
            feedback TEXT,
            created_at TIMESTAMP NOT NULL,
            started_at TIMESTAMP,
            closed_at TIMESTAMP,
            resolution_time INTEGER,
            FOREIGN KEY (session_id) REFERENCES chat_sessions (id),
            FOREIGN KEY (customer_id) REFERENCES customers (id),
            FOREIGN KEY (agent_id) REFERENCES agents (id)
        )
    ''')

    # Agent Activity Log Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS agent_activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            activity_type TEXT NOT NULL, -- login, logout, session_joined, session_closed, message_sent
            session_id INTEGER,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agents (id),
            FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
        )
    ''')

    # Agent Documents Table - Store multiple documents
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS agent_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            document_type TEXT NOT NULL, -- aadhar, pan, passport, degree, certificate
            document_name TEXT NOT NULL,
            document_data BLOB NOT NULL,
            document_number TEXT,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            verified BOOLEAN DEFAULT FALSE,
            verified_by INTEGER,
            verified_at TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agents (id)
        )
    ''')

    # Create indexes for better performance
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id ON ticket_history(ticket_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_ticket_history_customer_id ON ticket_history(customer_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_ticket_history_agent_id ON ticket_history(agent_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_agent_activity_agent_id ON agent_activity_log(agent_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_status ON chat_sessions(status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_ticket_id ON chat_sessions(ticket_id)')

    conn.commit()
    conn.close()
    print(f"✅ Support System Database initialized: {DB_NAME}")

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
    cursor = conn.cursor()
    try:
        hashed = get_password_hash(password)
        cursor.execute(
            "INSERT INTO agents (username, password_hash, name) VALUES (?, ?, ?)",
            (username, hashed, name)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def get_agent_by_username(username):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM agents WHERE username = ?", (username,))
    agent = cursor.fetchone()
    conn.close()
    return agent

def get_agent_by_id(agent_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
    agent = cursor.fetchone()
    conn.close()
    return agent

# --- Customer Operations ---
def create_customer(email, password, name):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        hashed = get_password_hash(password)
        cursor.execute(
            "INSERT INTO customers (email, password_hash, name) VALUES (?, ?, ?)",
            (email, hashed, name)
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def get_customer_by_email(email):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM customers WHERE email = ?", (email,))
    customer = cursor.fetchone()
    conn.close()
    return customer

def get_customer_by_id(customer_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM customers WHERE id = ?", (customer_id,))
    customer = cursor.fetchone()
    conn.close()
    return customer

def get_or_create_customer_by_email(email, name):
    """Get existing customer or create new one by email"""
    customer = get_customer_by_email(email)
    if customer:
        return dict(customer)
    
    # Create new customer with a default password
    customer_id = create_customer(email, "default_password", name)
    if customer_id:
        return get_customer_by_id(customer_id)
    return None

# --- Chat Operations ---
def create_session_with_email(customer_name: str, customer_email: str):
    """Create a new chat session for a customer (create customer if needed)"""
    # Get or create customer
    customer = get_or_create_customer_by_email(customer_email, customer_name)
    if not customer:
        raise Exception("Failed to create/get customer")
    
    customer_id = customer['id']
    
    # Create new session first to get session_id
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_sessions (customer_id, status) VALUES (?, 'pending')",
        (customer_id,)
    )
    session_id = cursor.lastrowid
    
    # Generate unique ticket ID using session_id
    from datetime import datetime
    ticket_id = f"TICKET-{datetime.now().strftime('%Y%m%d')}-{session_id:04d}"
    
    # Update session with ticket_id
    cursor.execute(
        "UPDATE chat_sessions SET ticket_id = ? WHERE id = ?",
        (ticket_id, session_id)
    )
    conn.commit()
    
    # Fetch the new session with customer details
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email 
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        WHERE s.id = ?
    ''', (session_id,))
    new_session = cursor.fetchone()
    conn.close()
    return dict(new_session)

def get_customer_active_session(customer_email: str):
    """Get customer's active or pending session by email"""
    customer = get_customer_by_email(customer_email)
    if not customer:
        return None
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email 
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        WHERE c.email = ? AND s.status IN ('pending', 'active')
        ORDER BY s.created_at DESC
        LIMIT 1
    ''', (customer_email,))
    session = cursor.fetchone()
    conn.close()
    return dict(session) if session else None

def get_session_by_id(session_id: int):
    """Get session by ID with customer details"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email 
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        WHERE s.id = ?
    ''', (session_id,))
    session = cursor.fetchone()
    conn.close()
    return dict(session) if session else None

def get_session_history(session_id: int):
    """Get all messages for a session"""
    return get_session_messages(session_id)

def get_or_create_active_session(customer_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check for existing active or pending session
    cursor.execute(
        "SELECT * FROM chat_sessions WHERE customer_id = ? AND status IN ('pending', 'active')",
        (customer_id,)
    )
    session = cursor.fetchone()
    
    if session:
        conn.close()
        return dict(session)
    
    # Create new session
    cursor.execute(
        "INSERT INTO chat_sessions (customer_id, status) VALUES (?, 'pending')",
        (customer_id,)
    )
    session_id = cursor.lastrowid
    conn.commit()
    
    # Fetch the new session
    cursor.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,))
    new_session = cursor.fetchone()
    conn.close()
    return dict(new_session)

def assign_agent_to_session(session_id, agent_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE chat_sessions SET agent_id = ?, status = 'active', started_at = ? WHERE id = ?",
        (agent_id, datetime.now(), session_id)
    )
    conn.commit()
    conn.close()

def close_session(session_id, resolution_note=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get session start time to calculate resolution time
    cursor.execute("SELECT started_at FROM chat_sessions WHERE id = ?", (session_id,))
    session = cursor.fetchone()
    resolution_time = None
    
    if session and session['started_at']:
        started_at = datetime.fromisoformat(session['started_at'])
        closed_at = datetime.now()
        resolution_time = int((closed_at - started_at).total_seconds())
    
    cursor.execute(
        "UPDATE chat_sessions SET status = 'closed', closed_at = ?, resolution_note = ?, resolution_time = ? WHERE id = ?",
        (datetime.now(), resolution_note, resolution_time, session_id)
    )
    conn.commit()
    conn.close()
    
    # Save to ticket history (using dynamic import to avoid circular dependency)
    try:
        from database_extensions import save_ticket_to_history
        save_ticket_to_history(session_id)
    except Exception as e:
        print(f"[WARNING] Failed to save ticket history: {e}")

def add_message(session_id, sender_type, sender_id, content):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (session_id, sender_type, sender_id, content) VALUES (?, ?, ?, ?)",
        (session_id, sender_type, sender_id, content)
    )
    msg_id = cursor.lastrowid
    conn.commit()
    
    cursor.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
    msg = cursor.fetchone()
    conn.close()
    return dict(msg)

def get_session_messages(session_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
    messages = cursor.fetchall()
    conn.close()
    return [dict(m) for m in messages]

def get_pending_sessions():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email 
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        WHERE s.status = 'pending'
    ''')
    sessions = cursor.fetchall()
    conn.close()
    return [dict(s) for s in sessions]

def get_agent_active_sessions(agent_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email 
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        WHERE s.agent_id = ? AND s.status = 'active'
    ''', (agent_id,))
    sessions = cursor.fetchall()
    conn.close()
    return [dict(s) for s in sessions]

def get_customer_sessions(customer_id, include_closed=True):
    conn = get_db_connection()
    cursor = conn.cursor()
    if include_closed:
        cursor.execute('''
            SELECT s.*, a.name as agent_name 
            FROM chat_sessions s
            LEFT JOIN agents a ON s.agent_id = a.id
            WHERE s.customer_id = ?
            ORDER BY s.created_at DESC
        ''', (customer_id,))
    else:
        cursor.execute('''
            SELECT s.*, a.name as agent_name 
            FROM chat_sessions s
            LEFT JOIN agents a ON s.agent_id = a.id
            WHERE s.customer_id = ? AND s.status != 'closed'
            ORDER BY s.created_at DESC
        ''', (customer_id,))
    sessions = cursor.fetchall()
    conn.close()
    return [dict(s) for s in sessions]

def get_closed_sessions_by_email(customer_email: str):
    """Get all closed sessions for a customer by email"""
    customer = get_customer_by_email(customer_email)
    if not customer:
        return []
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, a.name as agent_name, c.name as customer_name, c.email as customer_email
        FROM chat_sessions s
        LEFT JOIN agents a ON s.agent_id = a.id
        JOIN customers c ON s.customer_id = c.id
        WHERE c.email = ? AND s.status = 'closed'
        ORDER BY s.closed_at DESC
    ''', (customer_email,))
    sessions = cursor.fetchall()
    conn.close()
    return [dict(s) for s in sessions]

def get_agent_closed_sessions(agent_id: int):
    """Get all closed sessions for an agent"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        WHERE s.agent_id = ? AND s.status = 'closed'
        ORDER BY s.closed_at DESC
    ''', (agent_id,))
    sessions = cursor.fetchall()
    conn.close()
    return [dict(s) for s in sessions]

def get_customer_closed_sessions(customer_id):
    """Get customer's closed ticket history"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.*, a.name as agent_name,
               (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
        FROM chat_sessions s
        LEFT JOIN agents a ON s.agent_id = a.id
        WHERE s.customer_id = ? AND s.status = 'closed'
        ORDER BY s.closed_at DESC
    ''', (customer_id,))
    sessions = cursor.fetchall()
    conn.close()
    return [dict(s) for s in sessions]
