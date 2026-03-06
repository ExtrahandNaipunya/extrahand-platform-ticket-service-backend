# Support Agent Backend Server Dockerfile (CapRover-ready)
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY . .

# CapRover sets PORT at runtime; app uses process.env.PORT || 8001
EXPOSE 8001

CMD ["node", "server.js"]
