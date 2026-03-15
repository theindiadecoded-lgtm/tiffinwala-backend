require('dotenv').config();

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

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin:  '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

app.set('trust proxy', 1);

app.use(helmet());

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(morgan('dev'));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      100,
  message:  { error: 'Too many requests. Please try again in 15 minutes.' },
  skip: (req) => req.path === '/api/health',
});
app.use('/api/', limiter);

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      5,
  message:  { error: 'Too many OTP requests. Wait 10 minutes.' },
});
app.use('/api/auth/send-otp', otpLimiter);

app.use('/api', routes);

app.get('/', (req, res) => {
  res.json({
    name:    'TiffinWala API',
    version: '1.0.0',
    status:  'running',
    city:    'Motihari, Bihar 🍱',
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

app.use(errorHandler);

initSocket(io);
setIO(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log('\n🍱 ─────────────────────────────────────');
  console.log(`   TiffinWala Backend — Motihari`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Env:    ${process.env.NODE_ENV}`);
  console.log('─────────────────────────────────────\n');

  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL connected (Supabase)');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Check your DATABASE_URL in .env');
  }

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

process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down gracefully...');
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});