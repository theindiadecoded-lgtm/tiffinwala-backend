// ─────────────────────────────────────────────
//  src/controllers/authController.js
//  Handles OTP-based phone authentication.
//  Flow: sendOtp → verifyOtp → JWT issued
// ─────────────────────────────────────────────

const axios          = require('axios');
const prisma         = require('../config/database');
const { redis, setOtp, getOtp, deleteOtp } = require('../config/redis');
const { generateToken } = require('../middleware/auth');

// ── Generate a 6-digit OTP ──
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── Send OTP via Fast2SMS (cheap Indian SMS service) ──
const sendSmsOtp = async (phone, otp) => {
  // Remove +91 prefix for Fast2SMS
  const mobileNumber = phone.replace('+91', '').replace(/\s/g, '');

  if (process.env.NODE_ENV === 'development') {
    // In development: just log OTP instead of sending SMS (saves SMS credits)
    console.log(`\n📱 OTP for ${phone}: ${otp}\n`);
    return;
  }

  await axios.post('https://www.fast2sms.com/dev/bulkV2', null, {
    params: {
      authorization: process.env.FAST2SMS_API_KEY,
      variables_values: otp,
      route:            'otp',
      numbers:          mobileNumber,
    },
  });
};

// ════════════════════════════════════════════
//  POST /auth/send-otp
//  Body: { phone: "+919876543210" }
//  Generates OTP, stores in Redis, sends via SMS
// ════════════════════════════════════════════
const sendOtp = async (req, res) => {
  const { phone } = req.body;

  // Basic phone validation
  if (!phone || !/^\+91[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number. Use format: +91XXXXXXXXXX' });
  }

  // Rate limiting: max 3 OTPs per phone per 10 minutes
  const attempts = await redis.incr(`otp_attempts:${phone}`);
  if (attempts === 1) await redis.expire(`otp_attempts:${phone}`, 600); // 10 min TTL
  if (attempts > 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Wait 10 minutes.' });
  }

  const otp = generateOtp();
  await setOtp(phone, otp);
  await sendSmsOtp(phone, otp);

  res.json({ message: 'OTP sent successfully', phone });
};

// ════════════════════════════════════════════
//  POST /auth/verify-otp
//  Body: { phone, otp }
//  Verifies OTP → creates/finds user → returns JWT
// ════════════════════════════════════════════
const verifyOtp = async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required.' });
  }

  // Get stored OTP from Redis
  const storedOtp = await getOtp(phone);
  if (!storedOtp) {
    return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });
  }

  if (storedOtp !== otp.toString()) {
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  }

  // OTP correct — delete it so it can't be reused
  await deleteOtp(phone);
  await redis.del(`otp_attempts:${phone}`);

  // Find or create user (upsert)
  const user = await prisma.user.upsert({
    where:  { phone },
    update: { updatedAt: new Date() },      // existing user: update timestamp
    create: { phone, role: 'CUSTOMER' },    // new user: create with CUSTOMER role
    select: { id: true, phone: true, name: true, role: true, photoUrl: true },
  });

  // Generate JWT token
  const token = generateToken(user.id);

  res.json({
    message: 'Login successful',
    token,
    user,
  });
};

// ════════════════════════════════════════════
//  POST /auth/logout
//  Clears FCM token (stops push notifications)
// ════════════════════════════════════════════
const logout = async (req, res) => {
  // Clear FCM token so user stops receiving push notifications
  await prisma.user.update({
    where: { id: req.user.id },
    data:  { fcmToken: null },
  });
  res.json({ message: 'Logged out successfully' });
};

// ════════════════════════════════════════════
//  POST /auth/refresh
//  Issues a new token (call before expiry)
// ════════════════════════════════════════════
const refreshToken = async (req, res) => {
  const token = generateToken(req.user.id);
  res.json({ token });
};

module.exports = { sendOtp, verifyOtp, logout, refreshToken };
