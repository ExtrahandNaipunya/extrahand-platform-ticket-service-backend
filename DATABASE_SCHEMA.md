# Enhanced Database Schema - Agent Profiles & Ticket History

## Overview
The support system database has been significantly enhanced with comprehensive agent profile management, document storage, and automatic ticket history archiving.

## Database Schema Changes

### 1. Enhanced AGENTS Table
```sql
- id (PRIMARY KEY)
- username (UNIQUE)
- password_hash
- name
- email (UNIQUE)
- phone
- role (e.g., "Support Agent", "Senior Agent", "Team Lead")
- department
- status (online/offline)
- profile_picture (BLOB)
- aadhar_number
- aadhar_document (BLOB - deprecated, use agent_documents table)
- address
- city
- state
- country (default: India)
- postal_code
- date_of_birth
- joining_date
- employee_id (UNIQUE)
- emergency_contact_name
- emergency_contact_phone
- bank_account_number
- bank_ifsc_code
- pan_number
- created_at
- updated_at
```

### 2. Enhanced CUSTOMERS Table
```sql
- id (PRIMARY KEY)
- email (UNIQUE)
- password_hash
- name
- phone
- company
- profile_picture (BLOB)
- address
- city
- state
- country
- postal_code
- created_at
- updated_at
```

### 3. Enhanced CHAT_SESSIONS Table
```sql
- id (PRIMARY KEY)
- customer_id (FOREIGN KEY)
- agent_id (FOREIGN KEY)
- status (pending/active/closed)
- ticket_id (UNIQUE - format: TICKET-YYYYMMDD-XXXX)
- priority (low/medium/high/urgent)
- category
- subject
- rating (1-5)
- feedback
- created_at
- started_at (when agent joins)
- closed_at
- resolution_note
- resolution_time (seconds)
```

### 4. NEW: TICKET_HISTORY Table
Automatically populated when a ticket is closed. Provides fast retrieval of historical tickets without complex joins.

```sql
- id (PRIMARY KEY)
- ticket_id
- session_id (FOREIGN KEY)
- customer_id (FOREIGN KEY)
- customer_name (denormalized for speed)
- customer_email (denormalized for speed)
- agent_id (FOREIGN KEY)
- agent_name (denormalized for speed)
- status
- priority
- category
- subject
- total_messages
- resolution_note
- rating
- feedback
- created_at
- started_at
- closed_at
- resolution_time
```

**Indexes for Performance:**
- idx_ticket_history_ticket_id
- idx_ticket_history_customer_id
- idx_ticket_history_agent_id

### 5. NEW: AGENT_DOCUMENTS Table
Store multiple documents per agent (Aadhar, PAN, certificates, etc.)

```sql
- id (PRIMARY KEY)
- agent_id (FOREIGN KEY)
- document_type (aadhar/pan/passport/degree/certificate)
- document_name
- document_data (BLOB)
- document_number (e.g., Aadhar number, PAN number)
- upload_date
- verified (BOOLEAN)
- verified_by (admin who verified)
- verified_at
```

### 6. NEW: AGENT_ACTIVITY_LOG Table
Track all agent activities for compliance and auditing

```sql
- id (PRIMARY KEY)
- agent_id (FOREIGN KEY)
- activity_type (login/logout/session_joined/session_closed/message_sent)
- session_id (FOREIGN KEY, optional)
- details (JSON string for additional info)
- timestamp
```

## New API Endpoints

### Agent Profile Management

#### Get Agent Profile
```
GET /api/agent/profile/{agent_id}
```
Returns complete agent profile (excluding sensitive BLOB data and password)

Response:
```json
{
  "id": 1,
  "username": "admin",
  "name": "Ajay Kumar",
  "email": "ajay@extrahand.com",
  "phone": "+91-9876543210",
  "role": "Support Lead",
  "department": "Customer Support",
  "employee_id": "EMP001",
  "has_profile_picture": true,
  "created_at": "2026-01-01T00:00:00"
}
```

#### Update Agent Profile
```
PUT /api/agent/profile/{agent_id}
Content-Type: application/json

{
  "email": "newemail@example.com",
  "phone": "+91-9876543210",
  "role": "Senior Agent",
  "address": "123 Main Street",
  "city": "Mumbai",
  "state": "Maharashtra"
}
```

#### Get Agent Statistics
```
GET /api/agent/statistics/{agent_id}
```

Response:
```json
{
  "total_tickets": 142,
  "average_rating": 4.8,
  "average_resolution_time_minutes": 12.5,
  "tickets_by_status": {
    "closed": 140,
    "active": 2
  },
  "active_sessions": 1
}
```

#### Get Agent Documents
```
GET /api/agent/documents/{agent_id}
```

Response:
```json
{
  "documents": [
    {
      "id": 1,
      "document_type": "aadhar",
      "document_name": "aadhar_card.pdf",
      "document_number": "1234-5678-9012",
      "upload_date": "2026-01-01T10:00:00",
      "verified": true
    }
  ]
}
```

### Ticket History

#### Get Ticket by ID
```
GET /api/ticket/history/{ticket_id}
```

Response includes complete ticket details and all messages:
```json
{
  "ticket_id": "TICKET-20260101-0001",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "agent_name": "Ajay Kumar",
  "status": "closed",
  "total_messages": 15,
  "rating": 5,
  "resolution_time": 720,
  "messages": [
    {
      "content": "Hello, I need help",
      "sender_type": "customer",
      "timestamp": "2026-01-01T10:00:00"
    }
  ]
}
```

#### Get Customer Ticket History
```
GET /api/customer/ticket-history/{customer_email}?limit=50
```

Returns all tickets for a customer (default limit: 50)

#### Get Agent Ticket History
```
GET /api/agent/ticket-history/{agent_id}?limit=50
```

Returns all tickets handled by an agent (default limit: 50)

#### Get Customer Statistics
```
GET /api/customer/statistics/{customer_email}
```

Response:
```json
{
  "total_tickets": 25,
  "open_tickets": 1,
  "closed_tickets": 24
}
```

## Python Functions (database_extensions.py)

### Agent Profile Functions

```python
# Update agent profile
from database_extensions import update_agent_profile
update_agent_profile(agent_id, {
    "email": "new@email.com",
    "phone": "+91-1234567890",
    "role": "Senior Agent"
})

# Upload profile picture
from database_extensions import update_agent_profile_picture
with open("profile.jpg", "rb") as f:
    image_data = f.read()
update_agent_profile_picture(agent_id, image_data)

# Get complete profile
from database_extensions import get_agent_full_profile
profile = get_agent_full_profile(agent_id)

# Upload document
from database_extensions import upload_agent_document
with open("aadhar.pdf", "rb") as f:
    doc_data = f.read()
upload_agent_document(
    agent_id=1,
    document_type="aadhar",
    document_name="aadhar_card.pdf",
    document_data=doc_data,
    document_number="1234-5678-9012"
)

# Get all documents (metadata only)
from database_extensions import get_agent_documents
documents = get_agent_documents(agent_id)

# Get document binary data
from database_extensions import get_agent_document_data
doc_data = get_agent_document_data(document_id)

# Verify document
from database_extensions import verify_agent_document
verify_agent_document(document_id, verified_by_admin_id)
```

### Ticket History Functions

```python
# Get ticket history by ticket ID
from database_extensions import get_ticket_history_by_ticket_id
ticket = get_ticket_history_by_ticket_id("TICKET-20260101-0001")

# Get customer ticket history
from database_extensions import get_customer_ticket_history
tickets = get_customer_ticket_history("customer@example.com", limit=50)

# Get agent ticket history
from database_extensions import get_agent_ticket_history
tickets = get_agent_ticket_history(agent_id, limit=50)

# Get messages for a ticket
from database_extensions import get_ticket_messages_from_history
messages = get_ticket_messages_from_history("TICKET-20260101-0001")

# Manually save to history (auto-saved on close)
from database_extensions import save_ticket_to_history
save_ticket_to_history(session_id)
```

### Activity Logging

```python
# Log agent activity
from database_extensions import log_agent_activity
log_agent_activity(
    agent_id=1,
    activity_type="login",
    details="Logged in from IP 192.168.1.1"
)

# Get activity log
from database_extensions import get_agent_activity_log
logs = get_agent_activity_log(agent_id, limit=100)
```

### Statistics

```python
# Get agent statistics
from database_extensions import get_agent_statistics
stats = get_agent_statistics(agent_id)
# Returns: total_tickets, average_rating, average_resolution_time, etc.

# Get customer statistics
from database_extensions import get_customer_statistics
stats = get_customer_statistics("customer@example.com")
```

## Automatic Features

### 1. Auto-Save to Ticket History
When a session is closed using `close_session()`, it automatically:
- Calculates resolution time (started_at to closed_at)
- Saves complete ticket details to ticket_history table
- Denormalizes customer and agent names for fast retrieval

### 2. Auto-Timestamp on Agent Join
When an agent joins a session, `started_at` is automatically set for resolution time calculation.

### 3. Resolution Time Calculation
Automatically calculated in seconds when ticket is closed:
```python
resolution_time = (closed_at - started_at).total_seconds()
```

## Database Migration

The existing database will be automatically upgraded when you restart the backend server. All existing data is preserved, and new columns will have default or NULL values.

**To apply changes:**
```bash
# Stop the backend server (Ctrl+C)
# Delete the old database (optional, for clean slate)
rm support_system.db

# Restart the server
python server.py
```

The database will be recreated with all new tables and indexes.

## Usage Examples

### Example 1: Complete Agent Profile Setup
```python
# Update agent profile
update_agent_profile(1, {
    "email": "ajay@extrahand.com",
    "phone": "+91-9876543210",
    "role": "Support Lead",
    "department": "Customer Support",
    "address": "123 Support Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "country": "India",
    "postal_code": "400001",
    "employee_id": "EMP001",
    "pan_number": "ABCDE1234F",
    "aadhar_number": "1234-5678-9012"
})

# Upload documents
with open("aadhar.pdf", "rb") as f:
    upload_agent_document(1, "aadhar", "aadhar_card.pdf", f.read(), "1234-5678-9012")

with open("pan.pdf", "rb") as f:
    upload_agent_document(1, "pan", "pan_card.pdf", f.read(), "ABCDE1234F")
```

### Example 2: Retrieve Complete Ticket History
```python
# Get all tickets for a customer
tickets = get_customer_ticket_history("john@example.com")

# Get details of a specific ticket
ticket = get_ticket_history_by_ticket_id("TICKET-20260101-0001")

# Get all messages in that ticket
messages = get_ticket_messages_from_history("TICKET-20260101-0001")

# Print ticket summary
print(f"Ticket: {ticket['ticket_id']}")
print(f"Customer: {ticket['customer_name']}")
print(f"Agent: {ticket['agent_name']}")
print(f"Status: {ticket['status']}")
print(f"Messages: {ticket['total_messages']}")
print(f"Rating: {ticket['rating']}/5")
```

### Example 3: Agent Dashboard Statistics
```python
# Get agent stats for dashboard
stats = get_agent_statistics(1)
print(f"Total Cases Resolved: {stats['total_tickets']}")
print(f"Average Rating: {stats['average_rating']}/5")
print(f"Average Response Time: {stats['average_resolution_time_minutes']} minutes")
print(f"Active Sessions: {stats['active_sessions']}")
```

## Security Notes

1. **Password Hashes**: Never exposed in API responses
2. **BLOB Data**: Profile pictures and documents returned as indicators (has_profile_picture: true/false), actual data requires separate endpoint
3. **Sensitive Info**: Banking and Aadhar details only accessible to authorized administrators
4. **Document Verification**: Two-step process (upload → verify by admin)

## Performance Optimizations

1. **Denormalized Data**: Customer/agent names stored in ticket_history for fast retrieval
2. **Indexes**: Created on frequently queried fields (ticket_id, customer_id, agent_id)
3. **Separate History Table**: Avoids complex joins for historical queries
4. **Efficient Queries**: Uses prepared statements and parameterized queries

## Next Steps

1. Create UI for agent profile management
2. Add document upload interface
3. Implement ticket history viewer
4. Add analytics dashboard with charts
5. Create admin panel for document verification
