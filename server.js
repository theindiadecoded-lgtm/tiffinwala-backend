// ─────────────────────────────────────────────
//  server.js  — TiffinWala Backend Entry Point
//
//  Starts:
//   - Express HTTP server
//   - Socket.io WebSocket server
//   - PostgreSQL connection (via Prisma)
//   - Redis connection
//
//  Run:  node server.js
//  Dev:  nodemon server.js
// ─────────────────────────────────────────────

require('dotenv').config();   // load .env file first

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');

const prisma             = require('./src/config/database');
const { redis }          = require('./src/config/redis');
const routes             = require('./src/routes/index');
const { errorHandler }   = require('./src/middleware/errorHandler');
const { initSocket }     = require('./src/socket/socketHandler');
const { setIO }          = require('./src/controllers/orderController');

// ── Create Express app ──
const app    = express();
const server = http.createServer(app);   // HTTP server (needed for Socket.io)

// ── Create Socket.io server ──
const io = new Server(server, {
  cors: {
    origin:  '*',             // in production: set to your app domains
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

// ════════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════════

// Security headers
app.use(helmet());

// CORS — allow all origins in dev, restrict in production
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://your-admin-panel.vercel.app']  // TODO: set your admin URL
    : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Request logging (shows method + path + response time)
app.use(morgan('dev'));

// Parse JSON request bodies
app.use(express.json({ limit: '5mb' }));   // 5mb limit for base64 image uploads
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting: 100 requests per 15 minutes per IP ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max:      100,
  message:  { error: 'Too many requests. Please try again in 15 minutes.' },
  skip: (req) => req.path === '/api/health',  // don't rate-limit health checks
});
app.use('/api/', limiter);

// ── Stricter limiter for OTP endpoint ──
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  max:      5,                // max 5 OTP requests
  message:  { error: 'Too many OTP requests. Wait 10 minutes.' },
});
app.use('/api/auth/send-otp', otpLimiter);

// ════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name:    'TiffinWala API',
    version: '1.0.0',
    status:  'running',
    docs:    'See README.md for API documentation',
    city:    'Motihari, Bihar 🍱',
  });
});

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ── Global error handler (must be last) ──
app.use(errorHandler);

// ════════════════════════════════════════════
//  SOCKET.IO SETUP
// ════════════════════════════════════════════
initSocket(io);
setIO(io);  // give orderController access to io for emitting events

// ════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log('\n🍱 ─────────────────────────────────────');
  console.log(`   TiffinWala Backend — Motihari`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Env:    ${process.env.NODE_ENV}`);
  console.log('─────────────────────────────────────\n');

  // Test database connection
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL connected (Supabase)');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Check your DATABASE_URL in .env');
  }

  // Test Redis connection
  try {
    await redis.ping();
    console.log('✅ Redis connected (Upstash)');
  } catch (err) {
    console.error('❌ Redis connection failed:', err.message);
    console.error('   Check your REDIS_URL in .env');
  }

  console.log('\n📋 Available at:');
  console.log(`   API:    http://localhost:${PORT}/api`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   DB UI:  npx prisma studio\n`);
});

// ── Graceful shutdown on Ctrl+C ──
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down gracefully...');
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
