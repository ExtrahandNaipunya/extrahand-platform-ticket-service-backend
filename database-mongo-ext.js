const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// MongoDB — set MONGODB_URI in env (never commit cluster credentials as code defaults)
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/extrahand-support';

function maskMongoUri(uri) {
  try {
    return uri.replace(/\/\/([^:@/]+):([^@]+)@/, '//$1:***@');
  } catch {
    return '(invalid uri)';
  }
}

async function initializeDatabase() {
  try {
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB already connected');
      return;
    }
    if (mongoose.connection.readyState === 2) {
      await mongoose.connection.asPromise();
      console.log('✅ MongoDB connected (awaited in-flight connection)');
      return;
    }

    console.log('Connecting to MongoDB:', maskMongoUri(MONGODB_URI));
    await mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 10
    });
    console.log('✅ MongoDB Connected for Support Agent Backend');
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
    feedback: String,
    resolution_note: String,
    resolution_status: { type: String, enum: ['resolved', 'unresolved'], default: 'unresolved' },
    created_at: { type: Date, default: Date.now },
    joined_at: Date,
    closed_at: { type: Date, default: null }
}, { bufferCommands: false });


const messageSchema = new mongoose.Schema({
    session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession', required: true, index: true },
    content: { type: String, required: true },
    sender: { type: String, required: true }, // 'customer', 'agent', 'system'
    sender_type: String, // mapping to pg legacy
    timestamp: { type: Date, default: Date.now }
}, { bufferCommands: false });

const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { bufferCommands: false });

const ChatSession = mongoose.model('ChatSession', sessionSchema);
const ChatMessage = mongoose.model('ChatMessage', messageSchema);
const SystemSetting = mongoose.model('SystemSetting', settingsSchema);

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // In a real app, hash this!
    role: { type: String, enum: ['user', 'agent', 'admin', 'supervisor'], default: 'user' },
    status: { type: String, enum: ['active', 'inactive', 'suspended', 'pending'], default: 'active' },
    team: String,
    department: String,
    invitation_token: String,
    invitation_expires: Date,
    lastLoginAt: Date,
    createdAt: { type: Date, default: Date.now }
}, { bufferCommands: false });

const portalLogSchema = new mongoose.Schema({
    action: { type: String, required: true },
    details: String,
    user_email: String,
    timestamp: { type: Date, default: Date.now }
}, { bufferCommands: false });

const PortalLog = mongoose.model('PortalLog', portalLogSchema);
const User = mongoose.model('User', userSchema);

// Inquiry Schema for form submissions
const inquirySchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['pending', 'in_progress', 'resolved', 'closed'], default: 'pending', index: true },
    assigned_agent: { type: String, default: null }, // legacy: assigned agent email
    assigned_agent_id: { type: String, default: null, index: true }, // phase-2 canonical identity
    agent_notes: { type: String, default: null },
    resolution_note: { type: String, default: null },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now },
    resolved_at: { type: Date, default: null }
}, { bufferCommands: false });

const Inquiry = mongoose.model('Inquiry', inquirySchema);

// API Implementations
async function createSession(customerName, customerEmail, issueData = {}) {
    // Generate the session ID locally so we can use it for the ticket ID before saving
    const sessionId = new mongoose.Types.ObjectId();
    const ticketId = `TICKET-${sessionId.toString().substring(0, 8).toUpperCase()}`;

    const session = new ChatSession({
        _id: sessionId,
        customer_name: customerName,
        customer_email: customerEmail,
        status: 'pending',
        ticket_id: ticketId,
        issue_category: issueData.category || null,
        issue_type: issueData.type || null,
        issue_category_label: issueData.categoryLabel || null,
        issue_type_label: issueData.typeLabel || null,
        created_at: new Date()
    });

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

async function closeSession(sessionId, resolutionNote = null, resolutionStatus = 'resolved') {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;
    const session = await ChatSession.findByIdAndUpdate(
        sessionId,
        {
            status: 'closed',
            closed_at: new Date(),
            resolution_note: resolutionNote,
            resolution_status: resolutionStatus
        },
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

async function getSupervisorTicketsPaginated({
    page = 1,
    limit = 20,
    status = 'all',
    search = '',
    sortBy = 'newest'
} = {}) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const query = {};

    if (status && status !== 'all') {
        query.status = status;
    }

    if (search && String(search).trim()) {
        const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        query.$or = [
            { ticket_id: rx },
            { customer_name: rx },
            { customer_email: rx },
            { issue_category_label: rx },
            { issue_type_label: rx },
            { agent_email: rx }
        ];
    }

    const sort = sortBy === 'oldest' ? { created_at: 1 } : { created_at: -1 };
    const total = await ChatSession.countDocuments(query);
    const tickets = await ChatSession.find(query)
        .sort(sort)
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit);

    return {
        tickets: tickets.map((t) => ({ ...t.toObject(), id: t._id.toString() })),
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit))
    };
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
    // Chat Stats
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

    // Inquiry Stats
    const totalInquiries = await Inquiry.countDocuments();
    const inquiriesResolved = await Inquiry.countDocuments({ status: { $in: ['resolved', 'closed'] } });
    const inquiriesUnresolved = totalInquiries - inquiriesResolved;

    const inquiryStatusBreakdown = {
        pending: await Inquiry.countDocuments({ status: 'pending' }),
        in_progress: await Inquiry.countDocuments({ status: 'in_progress' }),
        resolved: await Inquiry.countDocuments({ status: 'resolved' }),
        closed: await Inquiry.countDocuments({ status: 'closed' })
    };

    const statusBreakdown = {
        pending: (await ChatSession.countDocuments({ status: 'pending' })) + inquiryStatusBreakdown.pending,
        active: (await ChatSession.countDocuments({ status: 'active' })) + inquiryStatusBreakdown.in_progress,
        closed: (await ChatSession.countDocuments({ status: 'closed' })) + inquiryStatusBreakdown.closed,
        resolved: (await ChatSession.countDocuments({ status: 'closed', resolution_status: 'resolved' })) + inquiryStatusBreakdown.resolved,
        unresolved: (await ChatSession.countDocuments({ status: 'closed', resolution_status: 'unresolved' })) + inquiriesUnresolved // Approximation for inquiries
    };

    const recentActivity = await ChatSession.find().sort({ created_at: -1 }).limit(5);
    const recentInquiries = await Inquiry.find().sort({ created_at: -1 }).limit(5);

    // Merge and sort combined recent activity
    const combinedActivity = [
        ...recentActivity.map(s => ({ ...s.toObject(), type: 'chat', id: s._id.toString() })),
        ...recentInquiries.map(i => ({ ...i.toObject(), type: 'inquiry', id: i._id.toString() }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

    return {
        total_tickets: totalTickets + totalInquiries,
        active_agents: activeAgents,
        avg_resolution_time: avgResolutionTime, // Keep this strictly for chats for now as inquiries can span days
        status_breakdown: statusBreakdown,
        recent_activity: combinedActivity
    };
}

async function getAgentPerformance() {
    // 1. Get stats for agents who have participated in closed sessions
    const chatPerformance = await ChatSession.aggregate([
        { $match: { status: 'closed', agent_email: { $ne: null } } },
        {
            $group: {
                _id: '$agent_email',
                total_chats: { $sum: 1 },
                resolved_chats: {
                    $sum: { $cond: [{ $eq: ['$resolution_status', 'resolved'] }, 1, 0] }
                },
                avg_rating: { $avg: '$rating' },
                avg_duration: { $avg: { $subtract: ['$closed_at', '$joined_at'] } }
            }
        }
    ]);

    // 2. Get stats for inquiries
    const inquiryPerformance = await Inquiry.aggregate([
        { $match: { assigned_agent: { $ne: null } } },
        {
            $group: {
                _id: '$assigned_agent',
                total_inquiries: { $sum: 1 },
                resolved_inquiries: {
                    $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] }
                },
                // Estimate duration if needed, or skip
            }
        }
    ]);

    // Create a map of email -> stats
    const statsMap = {};

    // Process Chat Stats
    chatPerformance.forEach(p => {
        statsMap[p._id] = {
            total_chats: p.total_chats,
            resolved_chats: p.resolved_chats,
            avg_rating: p.avg_rating,
            avg_duration: p.avg_duration,
            total_inquiries: 0,
            resolved_inquiries: 0
        };
    });

    // Process Inquiry Stats
    inquiryPerformance.forEach(p => {
        if (!statsMap[p._id]) {
            statsMap[p._id] = {
                total_chats: 0,
                resolved_chats: 0,
                avg_rating: null,
                avg_duration: null,
                total_inquiries: 0,
                resolved_inquiries: 0
            };
        }
        statsMap[p._id].total_inquiries = p.total_inquiries;
        statsMap[p._id].resolved_inquiries = p.resolved_inquiries;
    });

    // 2. Get all users who should be in the list
    const emailsWithStats = Object.keys(statsMap);

    const users = await User.find({
        $or: [
            { role: { $in: ['agent', 'admin', 'supervisor'] } },
            { email: { $in: emailsWithStats } }
        ]
    });

    const userMap = {};
    users.forEach(u => userMap[u.email] = u);

    // 3. Combine unique emails from both sources
    const allEmails = new Set([...emailsWithStats, ...users.map(u => u.email)]);

    const combinedResults = Array.from(allEmails).map(email => {
        const user = userMap[email];
        const stats = statsMap[email] || {
            total_chats: 0,
            resolved_chats: 0,
            avg_rating: null,
            avg_duration: null,
            total_inquiries: 0,
            resolved_inquiries: 0
        };

        const totalVolume = stats.total_chats + stats.total_inquiries;
        const totalResolved = stats.resolved_chats + stats.resolved_inquiries;

        return {
            agent_email: email,
            agent_name: user ? user.name : (email.split('@')[0] + ' (Deleted)'),
            role: user ? user.role : 'unknown',
            total_chats: stats.total_chats,
            resolved_chats: stats.resolved_chats,

            // New merged fields
            total_inquiries: stats.total_inquiries,
            resolved_inquiries: stats.resolved_inquiries,
            total_volume: totalVolume,

            resolution_rate: totalVolume > 0 ? Math.round((totalResolved / totalVolume) * 100) : 0,
            avg_rating: stats.avg_rating !== null ? stats.avg_rating.toFixed(1) : 'N/A',
            avg_duration: stats.avg_duration !== null ? `${Math.floor(stats.avg_duration / 60000)}m` : 'N/A',
            last_active: (user && (user.lastLoginAt || user.createdAt)) ? (user.lastLoginAt || user.createdAt) : null
        };
    });

    // Sort by total volume (desc), then by name (asc)
    return combinedResults.sort((a, b) => {
        if (b.total_volume !== a.total_volume) return b.total_volume - a.total_volume;
        return (a.agent_name || a.agent_email).localeCompare(b.agent_name || b.agent_email);
    });
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
            autoAssignChats: false,
            privacyMode: false,
            maintenanceMode: false
        };
    }

    return result;
}

async function updateSettings(newSettings, userEmail = 'admin') {
    for (const [key, value] of Object.entries(newSettings)) {
        await SystemSetting.findOneAndUpdate(
            { key },
            { value },
            { upsidert: true, new: true, upsert: true }
        );
    }

    // Log the change
    const log = new PortalLog({
        action: 'SETTINGS_UPDATE',
        details: `Updated system settings: ${Object.keys(newSettings).join(', ')}`,
        user_email: userEmail
    });
    await log.save();

    return await getSettings();
}

async function getPortalLogs(limit = 20) {
    const logs = await PortalLog.find().sort({ timestamp: -1 }).limit(limit);
    return logs.map(l => ({ ...l.toObject(), id: l._id.toString() }));
}

async function addPortalLog(action, details, userEmail) {
    const log = new PortalLog({ action, details, user_email: userEmail });
    await log.save();
    return log.toObject();
}

// User Management Functions
async function getAllUsers() {
    const users = await User.find({}).sort({ createdAt: -1 });
    return users.map(u => ({ ...u.toObject(), id: u._id.toString(), _id: u._id.toString() }));
}

async function createUser(userData) {
    const payload = { ...userData };
    if (
        payload.password &&
        typeof payload.password === 'string' &&
        !payload.password.startsWith('$2')
    ) {
        payload.password = await bcrypt.hash(payload.password, 10);
    }
    const user = new User(payload);
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
    const hashed = await bcrypt.hash(newPassword, 10);
    const user = await User.findByIdAndUpdate(userId, { password: hashed }, { new: true });
    return user ? true : false;
}

async function updateUserRole(userId, newRole) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const user = await User.findByIdAndUpdate(userId, { role: newRole }, { new: true });
    return user ? { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() } : null;
}

async function updateUserNameByEmail(email, name) {
    if (!email || !name) return null;
    const user = await User.findOneAndUpdate(
        { email: String(email).trim().toLowerCase() },
        { name: String(name).trim() },
        { new: true }
    );
    return user ? { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() } : null;
}

async function updateLastLogin(email) {
    return await User.findOneAndUpdate({ email }, { lastLoginAt: new Date() }, { new: true });
}

// Inquiry Management Functions
async function createInquiry(inquiryData) {
    const inquiry = new Inquiry({
        full_name: inquiryData.full_name,
        email: inquiryData.email,
        subject: inquiryData.subject,
        message: inquiryData.message,
        priority: inquiryData.priority || 'medium',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
    });
    await inquiry.save();
    return { ...inquiry.toObject(), id: inquiry._id.toString() };
}

async function getAllInquiries(filters = {}) {
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.assigned_agent) query.assigned_agent = filters.assigned_agent;
    if (filters.assigned_agent_id) query.assigned_agent_id = filters.assigned_agent_id;
    if (filters.assigned_agent_identity) {
        const parts = [];
        if (filters.assigned_agent_identity.id) {
            parts.push({ assigned_agent_id: filters.assigned_agent_identity.id });
        }
        if (filters.assigned_agent_identity.email) {
            parts.push({ assigned_agent: filters.assigned_agent_identity.email });
        }
        if (parts.length === 1) {
            Object.assign(query, parts[0]);
        } else if (parts.length > 1) {
            query.$or = parts;
        }
    }
    if (filters.priority) query.priority = filters.priority;

    const inquiries = await Inquiry.find(query).sort({ created_at: -1 });
    return inquiries.map(i => ({ ...i.toObject(), id: i._id.toString() }));
}

async function getInquiryById(inquiryId) {
    if (!mongoose.Types.ObjectId.isValid(inquiryId)) return null;
    const inquiry = await Inquiry.findById(inquiryId);
    return inquiry ? { ...inquiry.toObject(), id: inquiry._id.toString() } : null;
}

async function updateInquiryStatus(inquiryId, status, resolutionNote = null) {
    if (!mongoose.Types.ObjectId.isValid(inquiryId)) return null;
    const update = {
        status,
        updated_at: new Date()
    };
    if (resolutionNote) update.resolution_note = resolutionNote;
    if (status === 'resolved' || status === 'closed') update.resolved_at = new Date();

    const inquiry = await Inquiry.findByIdAndUpdate(inquiryId, update, { new: true });
    return inquiry ? { ...inquiry.toObject(), id: inquiry._id.toString() } : null;
}

async function assignInquiryToAgent(inquiryId, agentEmail, agentId = null) {
    if (!mongoose.Types.ObjectId.isValid(inquiryId)) return null;
    const inquiry = await Inquiry.findByIdAndUpdate(
        inquiryId,
        {
            assigned_agent: agentEmail,
            assigned_agent_id: agentId || null,
            status: 'in_progress',
            updated_at: new Date()
        },
        { new: true }
    );
    return inquiry ? { ...inquiry.toObject(), id: inquiry._id.toString() } : null;
}

async function addInquiryNotes(inquiryId, notes) {
    if (!mongoose.Types.ObjectId.isValid(inquiryId)) return null;
    const inquiry = await Inquiry.findByIdAndUpdate(
        inquiryId,
        {
            agent_notes: notes,
            updated_at: new Date()
        },
        { new: true }
    );
    return inquiry ? { ...inquiry.toObject(), id: inquiry._id.toString() } : null;
}

async function getInquiriesByEmail(email) {
    const inquiries = await Inquiry.find({ email }).sort({ created_at: -1 });
    return inquiries.map(i => ({ ...i.toObject(), id: i._id.toString() }));
}

async function getInquiriesAssignedToAgent(agentEmail) {
    const inquiries = await Inquiry.find({ assigned_agent: agentEmail }).sort({ created_at: -1 });
    return inquiries.map(i => ({ ...i.toObject(), id: i._id.toString() }));
}

async function getUserById(userId) {
    if (!userId) return null;
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const user = await User.findById(userId);
    return user ? { ...user.toObject(), id: user._id.toString(), _id: user._id.toString() } : null;
}

async function backfillInquiryAssignedAgentIds() {
    const inquiries = await Inquiry.find({
        assigned_agent: { $ne: null },
        $or: [{ assigned_agent_id: null }, { assigned_agent_id: { $exists: false } }]
    });

    let updated = 0;
    for (const inquiry of inquiries) {
        const agentEmail = String(inquiry.assigned_agent || '').trim().toLowerCase();
        if (!agentEmail) continue;
        const user = await User.findOne({ email: agentEmail });
        if (!user) continue;
        inquiry.assigned_agent_id = user._id.toString();
        await inquiry.save();
        updated += 1;
    }
    return { scanned: inquiries.length, updated };
}

/** Create default admin from ADMIN_EMAIL / ADMIN_PASSWORD (etc.) if missing */
async function seedAdminUserFromEnv() {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@extrahand.in').trim().toLowerCase();
    const adminPassword = (process.env.ADMIN_PASSWORD || 'Admin@123').trim();
    const adminName = (process.env.ADMIN_NAME || 'ExtraHand Admin').trim();
    let adminRole = (process.env.ADMIN_ROLE || 'admin').trim().toLowerCase();
    if (!['user', 'agent', 'admin', 'supervisor'].includes(adminRole)) {
        adminRole = 'admin';
    }

    const existing = await User.findOne({ email: adminEmail });
    if (existing) {
        return { created: false, email: adminEmail };
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const user = new User({
        name: adminName,
        email: adminEmail,
        password: passwordHash,
        role: adminRole,
        status: 'active'
    });
    await user.save();
    if (!process.env.ADMIN_PASSWORD) {
        console.log('⚠️ ADMIN_PASSWORD not set; using default password. Set ADMIN_PASSWORD in production.');
    }
    return { created: true, email: adminEmail };
}

module.exports = {
    updateLastLogin,
    initializeDatabase,
    createSession,
    getSession,
    updateSessionStatus,
    closeSession,
    getPendingSessions,
    getActiveSessions,
    getClosedSessions,
    getSupervisorTicketsPaginated,
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
    updateUserRole,
    updateUserNameByEmail,
    getPortalLogs,
    addPortalLog,
    // Inquiry Management
    createInquiry,
    getAllInquiries,
    getInquiryById,
    updateInquiryStatus,
    assignInquiryToAgent,
    addInquiryNotes,
    getInquiriesByEmail,
    getInquiriesAssignedToAgent,
    getUserById,
    backfillInquiryAssignedAgentIds,
    seedAdminUserFromEnv,
    getUserByEmail: async (email) => {
        if (!email || typeof email !== 'string') return null;
        const trimmed = email.trim();
        const lower = trimmed.toLowerCase();
        let user = await User.findOne({ email: lower });
        if (!user && lower !== trimmed) {
            user = await User.findOne({ email: trimmed });
        }
        return user ? { ...user.toObject(), id: user._id.toString() } : null;
    },
    acceptInvitation: async (token, password) => {
        const user = await User.findOne({
            invitation_token: token,
            invitation_expires: { $gt: new Date() }
        });

        if (!user) return null;

        user.password = await bcrypt.hash(password, 10);
        user.status = 'active';
        user.invitation_token = undefined;
        user.invitation_expires = undefined;
        user.joined_at = new Date();

        await user.save();
        return { ...user.toObject(), id: user._id.toString() };
    }
};
