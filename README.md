# ExtraHand Support Agent Backend Server

This server handles WebSocket connections for live chat between customers and support agents.

## Features
- Real-time WebSocket communication
- Agent dashboard connections
- Customer chat sessions
- Session management
- Message history
- Agent authentication

## Running the Server

```bash
# Activate virtual environment
E:\extrahanddummy2\envi\Scripts\activate

# Run the server
python server.py
```

Or use the batch file:
```bash
start_server.bat
```

## API Endpoints

- `GET /` - Root endpoint
- `GET /health` - Health check
- `POST /api/agent/login` - Agent login
- `GET /api/sessions/pending` - Get pending chat sessions
- `GET /api/sessions/{session_id}` - Get session details
- `POST /api/sessions/{session_id}/close` - Close a session
- `GET /api/agent/quick-replies` - Get quick reply templates

## WebSocket Endpoints

- `ws://localhost:8001/ws/customer/{customer_id}` - Customer connection
- `ws://localhost:8001/ws/agent/{username}` - Agent connection

## Port
Default: **8001**
