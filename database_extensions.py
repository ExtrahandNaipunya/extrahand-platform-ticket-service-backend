"""
Database Extensions for Agent Profile Management and Ticket History
"""
import sqlite3
from datetime import datetime
from typing import Optional, Dict, List
from database import get_db_connection

# ============= AGENT PROFILE MANAGEMENT =============

def update_agent_profile(agent_id: int, profile_data: Dict) -> bool:
    """Update agent profile with comprehensive data"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    allowed_fields = [
        'email', 'phone', 'role', 'department', 'address', 'city', 
        'state', 'country', 'postal_code', 'date_of_birth', 'joining_date',
        'employee_id', 'emergency_contact_name', 'emergency_contact_phone',
        'bank_account_number', 'bank_ifsc_code', 'pan_number', 'aadhar_number'
    ]
    
    update_fields = []
    values = []
    
    for field in allowed_fields:
        if field in profile_data:
            update_fields.append(f"{field} = ?")
            values.append(profile_data[field])
    
    if update_fields:
        update_fields.append("updated_at = ?")
        values.append(datetime.now().isoformat())
        values.append(agent_id)
        
        query = f"UPDATE agents SET {', '.join(update_fields)} WHERE id = ?"
        cursor.execute(query, values)
        conn.commit()
    
    conn.close()
    return True

def update_agent_profile_picture(agent_id: int, image_data: bytes) -> bool:
    """Update agent profile picture"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE agents SET profile_picture = ?, updated_at = ? WHERE id = ?",
        (image_data, datetime.now().isoformat(), agent_id)
    )
    conn.commit()
    conn.close()
    return True

def get_agent_profile_picture(agent_id: int) -> Optional[bytes]:
    """Get agent profile picture"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT profile_picture FROM agents WHERE id = ?", (agent_id,))
    result = cursor.fetchone()
    conn.close()
    return result['profile_picture'] if result else None

def get_agent_full_profile(agent_id: int) -> Optional[Dict]:
    """Get complete agent profile with all details"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
    agent = cursor.fetchone()
    conn.close()
    
    if agent:
        profile = dict(agent)
        # Remove sensitive data
        profile.pop('password_hash', None)
        # Convert BLOB to indicator
        profile['has_profile_picture'] = bool(profile.get('profile_picture'))
        profile.pop('profile_picture', None)
        profile.pop('aadhar_document', None)
        return profile
    return None

def upload_agent_document(agent_id: int, document_type: str, document_name: str, 
                          document_data: bytes, document_number: Optional[str] = None) -> int:
    """Upload agent document (Aadhar, PAN, certificates, etc.)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO agent_documents (agent_id, document_type, document_name, document_data, document_number)
        VALUES (?, ?, ?, ?, ?)
    ''', (agent_id, document_type, document_name, document_data, document_number))
    doc_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return doc_id

def get_agent_documents(agent_id: int) -> List[Dict]:
    """Get all documents for an agent (without binary data)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, agent_id, document_type, document_name, document_number, 
               upload_date, verified, verified_at
        FROM agent_documents 
        WHERE agent_id = ?
        ORDER BY upload_date DESC
    ''', (agent_id,))
    docs = cursor.fetchall()
    conn.close()
    return [dict(d) for d in docs]

def get_agent_document_data(document_id: int) -> Optional[bytes]:
    """Get specific document binary data"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT document_data FROM agent_documents WHERE id = ?", (document_id,))
    result = cursor.fetchone()
    conn.close()
    return result['document_data'] if result else None

def verify_agent_document(document_id: int, verified_by: int) -> bool:
    """Mark document as verified"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE agent_documents 
        SET verified = TRUE, verified_by = ?, verified_at = ?
        WHERE id = ?
    ''', (verified_by, datetime.now().isoformat(), document_id))
    conn.commit()
    conn.close()
    return True

# ============= TICKET HISTORY MANAGEMENT =============

def save_ticket_to_history(session_id: int) -> bool:
    """Save completed session to ticket history for easy retrieval"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get session details
    cursor.execute('''
        SELECT s.*, c.name as customer_name, c.email as customer_email, 
               a.name as agent_name,
               (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as total_messages
        FROM chat_sessions s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN agents a ON s.agent_id = a.id
        WHERE s.id = ?
    ''', (session_id,))
    
    session = cursor.fetchone()
    if not session:
        conn.close()
        return False
    
    # Insert into ticket_history
    cursor.execute('''
        INSERT INTO ticket_history (
            ticket_id, session_id, customer_id, customer_name, customer_email,
            agent_id, agent_name, status, priority, category, subject,
            total_messages, resolution_note, rating, feedback,
            created_at, started_at, closed_at, resolution_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        session['ticket_id'], session['id'], session['customer_id'],
        session['customer_name'], session['customer_email'],
        session.get('agent_id'), session.get('agent_name'),
        session['status'], session.get('priority'), session.get('category'),
        session.get('subject'), session['total_messages'],
        session.get('resolution_note'), session.get('rating'), session.get('feedback'),
        session['created_at'], session.get('started_at'), session.get('closed_at'),
        session.get('resolution_time')
    ))
    
    conn.commit()
    conn.close()
    return True

def get_ticket_history_by_ticket_id(ticket_id: str) -> Optional[Dict]:
    """Get complete ticket history by ticket ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM ticket_history WHERE ticket_id = ?', (ticket_id,))
    ticket = cursor.fetchone()
    conn.close()
    return dict(ticket) if ticket else None

def get_customer_ticket_history(customer_email: str, limit: int = 50) -> List[Dict]:
    """Get all ticket history for a customer"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM ticket_history 
        WHERE customer_email = ?
        ORDER BY closed_at DESC
        LIMIT ?
    ''', (customer_email, limit))
    tickets = cursor.fetchall()
    conn.close()
    return [dict(t) for t in tickets]

def get_agent_ticket_history(agent_id: int, limit: int = 50) -> List[Dict]:
    """Get all ticket history for an agent"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM ticket_history 
        WHERE agent_id = ?
        ORDER BY closed_at DESC
        LIMIT ?
    ''', (agent_id, limit))
    tickets = cursor.fetchall()
    conn.close()
    return [dict(t) for t in tickets]

def get_ticket_messages_from_history(ticket_id: str) -> List[Dict]:
    """Get all messages for a ticket from history"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # First get session_id from ticket_history
    cursor.execute('SELECT session_id FROM ticket_history WHERE ticket_id = ?', (ticket_id,))
    result = cursor.fetchone()
    
    if not result:
        conn.close()
        return []
    
    session_id = result['session_id']
    
    # Get messages
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
    return [dict(m) for m in messages]

# ============= AGENT ACTIVITY LOGGING =============

def log_agent_activity(agent_id: int, activity_type: str, session_id: Optional[int] = None, 
                       details: Optional[str] = None) -> int:
    """Log agent activity"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO agent_activity_log (agent_id, activity_type, session_id, details)
        VALUES (?, ?, ?, ?)
    ''', (agent_id, activity_type, session_id, details))
    log_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return log_id

def get_agent_activity_log(agent_id: int, limit: int = 100) -> List[Dict]:
    """Get agent activity log"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM agent_activity_log 
        WHERE agent_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    ''', (agent_id, limit))
    logs = cursor.fetchall()
    conn.close()
    return [dict(log) for log in logs]

# ============= ANALYTICS & STATISTICS =============

def get_agent_statistics(agent_id: int) -> Dict:
    """Get comprehensive agent statistics"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    stats = {}
    
    # Total tickets handled
    cursor.execute('SELECT COUNT(*) as total FROM ticket_history WHERE agent_id = ?', (agent_id,))
    stats['total_tickets'] = cursor.fetchone()['total']
    
    # Average rating
    cursor.execute('SELECT AVG(rating) as avg_rating FROM ticket_history WHERE agent_id = ? AND rating IS NOT NULL', (agent_id,))
    result = cursor.fetchone()
    stats['average_rating'] = round(result['avg_rating'], 2) if result['avg_rating'] else 0
    
    # Average resolution time (in minutes)
    cursor.execute('SELECT AVG(resolution_time) as avg_time FROM ticket_history WHERE agent_id = ? AND resolution_time IS NOT NULL', (agent_id,))
    result = cursor.fetchone()
    stats['average_resolution_time_minutes'] = round(result['avg_time'] / 60, 2) if result['avg_time'] else 0
    
    # Tickets by status
    cursor.execute('SELECT status, COUNT(*) as count FROM chat_sessions WHERE agent_id = ? GROUP BY status', (agent_id,))
    stats['tickets_by_status'] = {row['status']: row['count'] for row in cursor.fetchall()}
    
    # Active sessions
    cursor.execute('SELECT COUNT(*) as active FROM chat_sessions WHERE agent_id = ? AND status = "active"', (agent_id,))
    stats['active_sessions'] = cursor.fetchone()['active']
    
    conn.close()
    return stats

def get_customer_statistics(customer_email: str) -> Dict:
    """Get customer statistics"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    stats = {}
    
    # Get customer_id
    cursor.execute('SELECT id FROM customers WHERE email = ?', (customer_email,))
    customer = cursor.fetchone()
    if not customer:
        conn.close()
        return {}
    
    customer_id = customer['id']
    
    # Total tickets
    cursor.execute('SELECT COUNT(*) as total FROM ticket_history WHERE customer_id = ?', (customer_id,))
    stats['total_tickets'] = cursor.fetchone()['total']
    
    # Open tickets
    cursor.execute('SELECT COUNT(*) as open FROM chat_sessions WHERE customer_id = ? AND status IN ("pending", "active")', (customer_id,))
    stats['open_tickets'] = cursor.fetchone()['open']
    
    # Closed tickets
    cursor.execute('SELECT COUNT(*) as closed FROM ticket_history WHERE customer_id = ?', (customer_id,))
    stats['closed_tickets'] = cursor.fetchone()['closed']
    
    conn.close()
    return stats
