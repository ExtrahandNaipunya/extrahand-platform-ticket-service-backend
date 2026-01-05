# MongoDB Setup Guide (Optional)

## Current Setup
The system currently uses JSON file storage (`database.json`) which works perfectly for development and small-scale deployments.

## MongoDB Migration (Optional - For Production)

If you want to use MongoDB for better scalability and persistence:

### 1. Install MongoDB
Download and install MongoDB Community Edition from: https://www.mongodb.com/try/download/community

### 2. Start MongoDB Service
```bash
# Windows
net start MongoDB

# Linux/Mac
sudo systemctl start mongod
```

### 3. Update server startup
Instead of running `node server.js`, use:
```bash
node server-mongo.js
```

The `server-mongo.js` file is already created and ready to use with MongoDB.

### 4. MongoDB Features
- Automatic indexing on customer_email and status
- Better query performance
- Data persistence across server restarts
- Supports large chat histories
- ObjectId-based session IDs (more secure)

## Current JSON Storage Features
✅ Duplicate session prevention
✅ One active chat per customer
✅ Chat history persistence
✅ Duplicate connection prevention
✅ Session status management (pending/active/closed)

## What's Fixed
1. **No Duplicate Connections**: When customer connects twice, old connection is automatically closed
2. **One Session Per Customer**: System checks for existing active/pending sessions before creating new ones
3. **Session Reuse**: Customer reconnecting to existing session loads chat history automatically
4. **No Multiple Agents**: Only one agent can join a session at a time
5. **Closed Session Check**: Customers must close previous chat before starting new one

## Database Location
Current: `E:\extrahanddummy2\SupportAgentBackendServer\database.json`
MongoDB (if migrated): `mongodb://localhost:27017/extrahand_support`
