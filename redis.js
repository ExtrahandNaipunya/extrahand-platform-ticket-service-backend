const Redis = require('ioredis');

// Redis client configuration with graceful degradation
let redisAvailable = false;
let redisErrorLogged = false;

const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => {
    if (times > 2) {
      if (!redisErrorLogged) {
        console.log('⚠️  Redis not available - continuing without Redis (using in-memory queue only)');
        redisErrorLogged = true;
      }
      return null; // Stop retrying
    }
    return Math.min(times * 50, 500);
  },
  maxRetriesPerRequest: 2,
  lazyConnect: true,
  enableOfflineQueue: false,
  showFriendlyErrorStack: false
});

// Attempt to connect
redisClient.connect().then(() => {
  redisAvailable = true;
  console.log('✅ Redis connected successfully - queue management enabled');
}).catch(() => {
  redisAvailable = false;
  if (!redisErrorLogged) {
    console.log('⚠️  Redis not available - using in-memory queue only');
    redisErrorLogged = true;
  }
});

redisClient.on('error', () => {
  redisAvailable = false;
  // Silently fail after logging once
});

// Queue management functions
const QueueManager = {
  // Add a session to the categorized queue
  async addToQueue(sessionId, issueCategory, issueType, customerInfo) {
    if (!redisAvailable) {
      console.log(`[Queue] Redis unavailable - session ${sessionId} stored in database only`);
      return true;
    }
    
    try {
      const queueData = {
        sessionId,
        issueCategory,
        issueType,
        customerInfo,
        timestamp: Date.now(),
      };
      
      // Store in Redis sorted set (sorted by timestamp)
      await redisClient.zadd(
        `queue:${issueCategory}`,
        Date.now(),
        JSON.stringify(queueData)
      );
      
      // Also store session details in a hash for quick lookup
      await redisClient.hset(
        `session:${sessionId}`,
        'issueCategory', issueCategory,
        'issueType', issueType,
        'customerInfo', JSON.stringify(customerInfo),
        'status', 'pending'
      );
      
      console.log(`[Redis Queue] Added session ${sessionId} to ${issueCategory} queue`);
      return true;
    } catch (error) {
      console.error('[Redis Queue] Error adding to queue:', error.message);
      return false;
    }
  },

  // Get all pending sessions from a specific category queue
  async getQueueByCategory(issueCategory) {
    if (!redisAvailable) return [];
    
    try {
      const results = await redisClient.zrange(`queue:${issueCategory}`, 0, -1);
      return results.map(item => JSON.parse(item));
    } catch (error) {
      console.error('[Redis Queue] Error getting queue:', error.message);
      return [];
    }
  },

  // Get all pending sessions across all categories
  async getAllQueues() {
    if (!redisAvailable) return {};
    
    try {
      const categories = [
        'order_issues',
        'membership',
        'delivery',
        'payment_billing',
        'product_quality',
        'technical',
        'general'
      ];
      
      const allQueues = {};
      for (const category of categories) {
        const queue = await this.getQueueByCategory(category);
        if (queue.length > 0) {
          allQueues[category] = queue;
        }
      }
      
      return allQueues;
    } catch (error) {
      console.error('[Redis Queue] Error getting all queues:', error.message);
      return {};
    }
  },

  // Remove session from queue when accepted by agent
  async removeFromQueue(sessionId) {
    if (!redisAvailable) {
      console.log(`[Queue] Redis unavailable - session ${sessionId} removal skipped`);
      return true;
    }
    
    try {
      // Get session details
      const sessionData = await redisClient.hgetall(`session:${sessionId}`);
      
      if (sessionData && sessionData.issueCategory) {
        // Remove from sorted set
        const queueKey = `queue:${sessionData.issueCategory}`;
        const members = await redisClient.zrange(queueKey, 0, -1);
        
        for (const member of members) {
          const data = JSON.parse(member);
          if (data.sessionId === parseInt(sessionId)) {
            await redisClient.zrem(queueKey, member);
            break;
          }
        }
        
        // Update session status
        await redisClient.hset(`session:${sessionId}`, 'status', 'active');
        
        console.log(`[Redis Queue] Removed session ${sessionId} from queue`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[Redis Queue] Error removing from queue:', error.message);
      return false;
    }
  },

  // Get session details
  async getSessionDetails(sessionId) {
    if (!redisAvailable) return null;
    
    try {
      const data = await redisClient.hgetall(`session:${sessionId}`);
      if (data && data.customerInfo) {
        data.customerInfo = JSON.parse(data.customerInfo);
      }
      return data;
    } catch (error) {
      console.error('[Redis Queue] Error getting session details:', error.message);
      return null;
    }
  },

  // Clear session data when chat is closed
  async clearSession(sessionId) {
    if (!redisAvailable) return true;
    
    try {
      await this.removeFromQueue(sessionId);
      await redisClient.del(`session:${sessionId}`);
      console.log(`[Redis Queue] Cleared session ${sessionId}`);
      return true;
    } catch (error) {
      console.error('[Redis Queue] Error clearing session:', error.message);
      return false;
    }
  }
};

module.exports = { redisClient, QueueManager };
