/**
 * Seed script to populate the database with dummy agents and performance data
 * Run with: node seed-dummy-agents.js
 */

const mongoose = require('mongoose');

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://extrahand614_db_user:aEgPtYiKNpHuSjDU@cluster0.wjubwjn.mongodb.net/?appName=Cluster0';

// Schemas (matching database-mongo-ext.js)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin', 'supervisor'], default: 'user' },
    status: { type: String, enum: ['active', 'inactive', 'suspended', 'pending'], default: 'active' },
    lastLoginAt: Date,
    createdAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
    customer_name: String,
    customer_email: { type: String, required: true, index: true },
    agent_email: { type: String, default: null },
    status: { type: String, enum: ['pending', 'active', 'closed'], default: 'pending', index: true },
    ticket_id: { type: String },
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
    sender: { type: String, required: true },
    sender_type: String,
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const ChatSession = mongoose.model('ChatSession', sessionSchema);
const ChatMessage = mongoose.model('ChatMessage', messageSchema);

// Dummy Agents Data
const dummyAgents = [
    { name: 'Rahul Kumar', email: 'rahul.k@extrahand.com', password: 'agent123', role: 'user', status: 'active' },
    { name: 'Priya Sharma', email: 'priya.s@extrahand.com', password: 'agent123', role: 'user', status: 'active' },
    { name: 'Mike Johnson', email: 'mike.j@extrahand.com', password: 'agent123', role: 'user', status: 'active' },
    { name: 'Sarah Lee', email: 'sarah.l@extrahand.com', password: 'agent123', role: 'user', status: 'active' },
    { name: 'David Brown', email: 'david.b@extrahand.com', password: 'agent123', role: 'user', status: 'active' }
];

// Customer names for dummy sessions
const customerNames = [
    'John Doe', 'Jane Smith', 'Robert Wilson', 'Emily Davis', 'Michael Brown',
    'Sarah Johnson', 'James Williams', 'Patricia Jones', 'Christopher Garcia', 'Jessica Martinez',
    'Daniel Anderson', 'Nancy Taylor', 'Matthew Thomas', 'Betty Moore', 'Andrew Jackson'
];

// Issue categories
const issueTypes = [
    { category: 'technical', type: 'Technical Support', label: 'Technical Issue' },
    { category: 'billing', type: 'Billing Inquiry', label: 'Billing Question' },
    { category: 'account', type: 'Account Access', label: 'Account Issue' },
    { category: 'general', type: 'General Query', label: 'General Inquiry' },
    { category: 'feedback', type: 'Feedback', label: 'Customer Feedback' }
];

// Generate random date in the past N days
function randomDateInPast(days) {
    const now = new Date();
    const pastDate = new Date(now.getTime() - Math.random() * days * 24 * 60 * 60 * 1000);
    return pastDate;
}

// Generate random duration between min and max minutes
function randomDuration(minMinutes, maxMinutes) {
    return (minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60 * 1000;
}

// Generate unique ticket ID
let ticketCounter = 0;
function generateTicketId() {
    ticketCounter++;
    return `T-${Date.now()}-${ticketCounter}`;
}

// Small delay to ensure unique timestamps
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function seedDatabase() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // 1. Create Dummy Agents
        console.log('\n📝 Creating dummy agents...');
        for (const agent of dummyAgents) {
            try {
                const existingUser = await User.findOne({ email: agent.email });
                if (existingUser) {
                    console.log(`   ⚠️  Agent ${agent.email} already exists, skipping...`);
                } else {
                    await User.create(agent);
                    console.log(`   ✅ Created agent: ${agent.name} (${agent.email})`);
                }
            } catch (err) {
                if (err.code === 11000) {
                    console.log(`   ⚠️  Agent ${agent.email} already exists, skipping...`);
                } else {
                    throw err;
                }
            }
        }

        // 2. Create Dummy Chat Sessions for each agent (to generate performance data)
        console.log('\n📝 Creating dummy chat sessions for performance data...');

        const sessionsPerAgent = [15, 12, 18, 10, 14]; // Different volumes for variety

        for (let i = 0; i < dummyAgents.length; i++) {
            const agent = dummyAgents[i];
            const numSessions = sessionsPerAgent[i];
            console.log(`   Creating ${numSessions} sessions for ${agent.name}...`);

            for (let j = 0; j < numSessions; j++) {
                const issue = issueTypes[Math.floor(Math.random() * issueTypes.length)];
                const customer = customerNames[Math.floor(Math.random() * customerNames.length)];
                const createdAt = randomDateInPast(30); // Within last 30 days
                const duration = randomDuration(5, 25); // 5-25 minutes
                const joinedAt = new Date(createdAt.getTime() + Math.random() * 2 * 60 * 1000); // Joined within 2 mins
                const closedAt = new Date(joinedAt.getTime() + duration);
                const rating = 3.5 + Math.random() * 1.5; // Rating between 3.5 and 5.0

                const session = new ChatSession({
                    customer_name: customer,
                    customer_email: `${customer.toLowerCase().replace(' ', '.')}@example.com`,
                    agent_email: agent.email,
                    status: 'closed',
                    ticket_id: generateTicketId(),
                    issue_category: issue.category,
                    issue_type: issue.type,
                    issue_category_label: issue.label,
                    issue_type_label: issue.type,
                    rating: Math.round(rating * 10) / 10,
                    resolution_note: `Resolved ${issue.type.toLowerCase()} successfully.`,
                    created_at: createdAt,
                    joined_at: joinedAt,
                    closed_at: closedAt
                });

                await session.save();

                // Add some dummy messages
                await ChatMessage.create([
                    { session_id: session._id, content: `Hello, I need help with ${issue.type.toLowerCase()}.`, sender: 'customer', sender_type: 'customer', timestamp: createdAt },
                    { session_id: session._id, content: `Hello ${customer}! I'm ${agent.name} and I'll be happy to help you today.`, sender: 'agent', sender_type: 'agent', timestamp: joinedAt },
                    { session_id: session._id, content: 'Thank you for your help!', sender: 'customer', sender_type: 'customer', timestamp: new Date(closedAt.getTime() - 60000) },
                    { session_id: session._id, content: 'Session closed. Resolution: Issue resolved successfully.', sender: 'system', sender_type: 'system', timestamp: closedAt }
                ]);

                await delay(5); // Small delay to ensure unique ticket IDs
            }
            console.log(`   ✅ Created ${numSessions} sessions for ${agent.name}`);
        }

        // 3. Create a few pending and active sessions for live activity
        console.log('\n📝 Creating live activity sessions...');

        // 2 pending sessions
        for (let i = 0; i < 2; i++) {
            const issue = issueTypes[Math.floor(Math.random() * issueTypes.length)];
            const customer = customerNames[Math.floor(Math.random() * customerNames.length)];

            const session = new ChatSession({
                customer_name: customer,
                customer_email: `${customer.toLowerCase().replace(' ', '.')}@example.com`,
                status: 'pending',
                ticket_id: generateTicketId(),
                issue_category: issue.category,
                issue_type: issue.type,
                issue_category_label: issue.label,
                issue_type_label: issue.type,
                created_at: new Date()
            });
            await session.save();
            console.log(`   ✅ Created pending session: ${session.ticket_id}`);
            await delay(10);
        }

        // 3 active sessions (assigned to agents)
        for (let i = 0; i < 3; i++) {
            const issue = issueTypes[Math.floor(Math.random() * issueTypes.length)];
            const customer = customerNames[Math.floor(Math.random() * customerNames.length)];
            const agent = dummyAgents[i % dummyAgents.length];
            const createdAt = new Date(Date.now() - Math.random() * 30 * 60 * 1000); // Within last 30 mins

            const session = new ChatSession({
                customer_name: customer,
                customer_email: `${customer.toLowerCase().replace(' ', '.')}@example.com`,
                agent_email: agent.email,
                status: 'active',
                ticket_id: generateTicketId(),
                issue_category: issue.category,
                issue_type: issue.type,
                issue_category_label: issue.label,
                issue_type_label: issue.type,
                created_at: createdAt,
                joined_at: new Date(createdAt.getTime() + 30000)
            });
            await session.save();
            console.log(`   ✅ Created active session: ${session.ticket_id} (Agent: ${agent.name})`);
            await delay(10);
        }

        console.log('\n' + '═'.repeat(60));
        console.log('✅ DATABASE SEEDING COMPLETE!');
        console.log('═'.repeat(60));
        console.log('\n📋 AGENT CREDENTIALS (Password for all: agent123)');
        console.log('─'.repeat(60));
        dummyAgents.forEach(agent => {
            console.log(`   ${agent.name.padEnd(20)} │ ${agent.email}`);
        });
        console.log('─'.repeat(60));

    } catch (error) {
        console.error('❌ Error seeding database:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

// Run the seed
seedDatabase();
