import sqlite3

conn = sqlite3.connect('support_system.db')
cursor = conn.cursor()

# Check if ticket_id column exists
cursor.execute('PRAGMA table_info(chat_sessions)')
columns = [col[1] for col in cursor.fetchall()]
print('Current columns:', columns)

if 'ticket_id' not in columns:
    cursor.execute('ALTER TABLE chat_sessions ADD COLUMN ticket_id TEXT')
    conn.commit()
    print('✅ Added ticket_id column')
else:
    print('✅ ticket_id column already exists')

# Generate ticket IDs for existing sessions
cursor.execute("SELECT id, customer_id, created_at FROM chat_sessions WHERE ticket_id IS NULL")
sessions = cursor.fetchall()

for session in sessions:
    session_id, customer_id, created_at = session
    from datetime import datetime
    # Parse created_at or use current date
    try:
        date_part = datetime.strptime(created_at[:10], '%Y-%m-%d').strftime('%Y%m%d')
    except:
        date_part = datetime.now().strftime('%Y%m%d')
    
    ticket_id = f"TICKET-{date_part}-{session_id:04d}"
    cursor.execute("UPDATE chat_sessions SET ticket_id = ? WHERE id = ?", (ticket_id, session_id))
    print(f"Generated ticket ID {ticket_id} for session {session_id}")

conn.commit()
print(f'✅ Updated {len(sessions)} sessions with ticket IDs')
conn.close()
