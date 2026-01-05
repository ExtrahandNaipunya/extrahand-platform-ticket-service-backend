# Support Agent Backend Server Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Expose WebSocket port
EXPOSE 9000

# Start server
CMD ["npm", "start"]
