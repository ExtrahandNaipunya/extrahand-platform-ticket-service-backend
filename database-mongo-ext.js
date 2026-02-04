const mongoose = require('mongoose');

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://extrahand614_db_user:aEgPtYiKNpHuSjDU@cluster0.wjubwjn.mongodb.net/?appName=Cluster0';

async function initializeDatabase() {
    try {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(MONGODB_URI);
            console.log('✅ MongoDB Connected for Support Agent Backend');
        }
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
        throw error;
    }
}

// Schemas
const sessionSchema = new mongoose.Schema({
    customer_name: String,
    customer_email: { type: String, required: true, index: true },
    agent_email: { type: String, default: null },
    status: { type: String, enum: ['pending', 'active', 'closed'], default: 'pending', index: true },
    ticket_id: { type: String, unique: true },
    issue_category: String,
    issue_type: String,
    issue_category_label: String,
    issue_type_label: String,
    rating: Number,
    resolution_note: String,
    created_at: { type: Date, default: Date.now },
    joined_at: Date,
    closed_at: { type: Date, default: null }
});

const messageSchema = new mongoose.Schema({
    session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession', required: true, index: true },
    content: { type: String, required: true },
    sender: { type: String, required: true }, // 'customer', 'agent', 'system'
    sender_type: String, // mapping to pg legacy
    timestamp: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
});

const ChatSession = mongoose.model('ChatSession', sessionSchema);
const ChatMessage = mongoose.model('ChatMessage', messageSchema);
const SystemSetting = mongoose.model('SystemSetting', settingsSchema);

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // In a real app, hash this!
    role: { type: String, enum: ['user', 'admin', 'supervisor'], default: 'user' },
    status: { type: String, enum: ['active', 'inactive', 'suspended', 'pending'], default: 'active' },
    lastLoginAt: Date,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// API Implementations
async function createSession(customerName, customerEmail, issueData = {}) {
    const session = new ChatSession({
        customer_name: customerName,
        customer_email: customerEmail,
        status: 'pending',
        issue_category: issueData.category || null,
        issue_type: issueData.type || null,
        issue_category_label: issueData.categoryLabel || null,
        issue_type_label: issueData.typeLabel || null,
        created_at: new Date()
    });

    await session.save();

    // Generate ticket ID
    const ticketId = `TICKET-${session._id.toString().substring(0, 8).toUpperCase()}`;
    session.ticket_id = ticketId;
    await session.save();

    return { ...session.toObject(), id: session._id.toString() };
}

async function getSession(sessionId) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const session = await ChatSession.findById(sessionId);
    return session ? { ...session.toObject(), id: session._id.toString() } : null;
}

async function updateSessionStatus(sessionId, status, agentEmail = null) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const update = { status };
    if (agentEmail) {
        update.agent_email = agentEmail;
        update.joined_at = new Date();
    }
    const session = await ChatSession.findByIdAndUpdate(sessionId, update, { new: true });
    return session ? { ...session.toObject(), id: session._id.toString() } : null;
}

async function closeSession(sessionId, resolutionNote = null) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const session = await ChatSession.findByIdAndUpdate(
        sessionId,
        { status: 'closed', closed_at: new Date(), resolution_note: resolutionNote },
        { new: true }
    );
    return session ? { ...session.toObject(), id: session._id.toString() } : null;
}

async function getPendingSessions() {
    const sessions = await ChatSession.find({ status: 'pending' }).sort({ created_at: 1 });
    return sessions.map(s => ({ ...s.toObject(), id: s._id.toString() }));
}

async function getActiveSessions(agentEmail = null) {
    const query = { status: 'active' };
    if (agentEmail) query.agent_email = agentEmail;
    const sessions = await ChatSession.find(query).sort({ joined_at: -1 });
    return sessions.map(s => ({ ...s.toObject(), id: s._id.toString() }));
}

async function getClosedSessions(agentEmail = null, customerEmail = null, limit = null) {
    const query = { status: 'closed' };
    if (agentEmail) query.agent_email = agentEmail;
    if (customerEmail) query.customer_email = customerEmail;
    let dbQuery = ChatSession.find(query).sort({ closed_at: -1 });
    if (limit) dbQuery = dbQuery.limit(parseInt(limit));
    const sessions = await dbQuery;
    return sessions.map(s => ({ ...s.toObject(), id: s._id.toString() }));
}

async function getSessionByTicketId(ticketId) {
    const session = await ChatSession.findOne({ ticket_id: ticketId });
    return session ? { ...session.toObject(), id: session._id.toString() } : null;
}

async function addMessage(sessionId, content, senderType) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const message = new ChatMessage({
        session_id: sessionId,
        content: content,
        sender: senderType, // 'customer', 'agent', 'system'
        sender_type: senderType, // for pg compatibility
        timestamp: new Date()
    });
    await message.save();
    return { ...message.toObject(), id: message._id.toString() };
}

async function getMessages(sessionId) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return [];
    const messages = await ChatMessage.find({ session_id: sessionId }).sort({ timestamp: 1 });
    return messages.map(m => ({ ...m.toObject(), id: m._id.toString() }));
}

async function getActiveSessionForCustomer(customerEmail) {
    const session = await ChatSession.findOne({
        customer_email: customerEmail,
        status: { $in: ['pending', 'active'] }
    }).sort({ created_at: -1 });
    return session ? { ...session.toObject(), id: session._id.toString() } : null;
}

async function getSystemStats() {
    const totalTickets = await ChatSession.countDocuments();
    const activeAgents = (await ChatSession.distinct('agent_email', { status: 'active' })).length;

    const closedSessions = await ChatSession.find({ status: 'closed', joined_at: { $ne: null }, closed_at: { $ne: null } });
    let totalResolutionTime = 0;
    closedSessions.forEach(s => {
        totalResolutionTime += (s.closed_at - s.joined_at) / 1000;
    });
    const avgResolutionSeconds = closedSessions.length > 0 ? totalResolutionTime / closedSessions.length : 0;
    const minutes = Math.floor(avgResolutionSeconds / 60);
    const avgResolutionTime = `${minutes}m ${Math.round(avgResolutionSeconds % 60)}s`;

    const statusBreakdown = {
        pending: await ChatSession.countDocuments({ status: 'pending' }),
        active: await ChatSession.countDocuments({ status: 'active' }),
        closed: await ChatSession.countDocuments({ status: 'closed' })
    };

    const recentActivity = await ChatSession.find().sort({ created_at: -1 }).limit(5);

    return {
        total_tickets: totalTickets,
        active_agents: activeAgents,
        avg_resolution_time: avgResolutionTime,
        status_breakdown: statusBreakdown,
        recent_activity: recentActivity.map(s => ({ ...s.toObject(), id: s._id.toString() }))
    };
}

async function getAgentPerformance() {
    const performance = await ChatSession.aggregate([
        { $match: { status: 'closed', agent_email: { $ne: null } } },
        {
            $group: {
                _id: '$agent_email',
                total_chats: { $sum: 1 },
                avg_rating: { $avg: '$rating' },
                avg_duration: { $avg: { $subtract: ['$closed_at', '$joined_at'] } }
            }
        },
        { $sort: { total_chats: -1 } }
    ]);

    return performance.map(p => ({
        agent_email: p._id,
        total_chats: p.total_chats,
        avg_rating: p.avg_rating ? p.avg_rating.toFixed(1) : 'N/A',
        avg_duration: p.avg_duration ? `${Math.floor(p.avg_duration / 60000)}m` : 'N/A'
    }));
}

async function getAllActiveSessions() {
    const sessions = await ChatSession.find({ status: 'active' }).sort({ joined_at: -1 });
    const formattedSessions = [];

    for (const session of sessions) {
        const lastMsg = await ChatMessage.findOne({ session_id: session._id }).sort({ timestamp: -1 });
        formattedSessions.push({
            ...session.toObject(),
            id: session._id.toString(),
            last_message: lastMsg ? lastMsg.content : null,
            last_sender: lastMsg ? lastMsg.sender : null
        });
    }

    return formattedSessions;
}

async function getSettings() {
    const settings = await SystemSetting.find();
    const result = {};
    settings.forEach(s => {
        result[s.key] = s.value;
    });

    // Default settings if empty
    if (Object.keys(result).length === 0) {
        return {
            siteName: 'ExtraHand Support',
            supportEmail: 'support@extrahand.com',
            operatingHours: '9:00 AM - 6:00 PM',
            timezone: 'Asia/Kolkata (IST)',
            enableEmailNotifications: true,
            enableSoundAlerts: true,
            autoAssignChats: true,
            maintenanceMode: false
        };
    }
    return result;
}

async function updateSettings(newSettings) {
    for (const [key, value] of Object.entries(newSettings)) {
        await SystemSetting.findOneAndUpdate(
            { key },
            { value },
            { upsidert: true, new: true, upsert: true }
        );
    }
    return await getSettings();
}

// User Management Functions
async function getAllUsers() {
    const users = await User.find({}).sort({ createdAt: -1 });
    return users.map(u => ({ ...u.toObject(), id: u._id.toString(), _id: u._id.toString() }));
}

async function createUser(userData) {
    const user = new User(userData);
    await user.save();
    return { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() };
}

async function suspendUser(userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const user = await User.findByIdAndUpdate(userId, { status: 'suspended' }, { new: true });
    return user ? { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() } : null;
}

async function activateUser(userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const user = await User.findByIdAndUpdate(userId, { status: 'active' }, { new: true });
    return user ? { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() } : null;
}

async function deleteUser(userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    await User.findByIdAndDelete(userId);
    return true;
}

async function updateUserPassword(userId, newPassword) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    // In production, hash this password!
    const user = await User.findByIdAndUpdate(userId, { password: newPassword }, { new: true });
    return user ? true : false;
}

async function updateUserRole(userId, newRole) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const user = await User.findByIdAndUpdate(userId, { role: newRole }, { new: true });
    return user ? { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() } : null;
}

module.exports = {
    initializeDatabase,
    createSession,
    getSession,
    updateSessionStatus,
    closeSession,
    getPendingSessions,
    getActiveSessions,
    getClosedSessions,
    getSessionByTicketId,
    addMessage,
    getMessages,
    getActiveSessionForCustomer,
    getSystemStats,
    getAgentPerformance,
    getAllActiveSessions,
    getSettings,
    updateSettings,
    getAllUsers,
    createUser,
    suspendUser,
    activateUser,
    deleteUser,
    updateUserPassword,
    updateUserRole
};
