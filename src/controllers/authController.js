const axios          = require('axios');
const admin          = require('firebase-admin');
const prisma         = require('../config/database');
const { redis, setOtp, getOtp, deleteOtp } = require('../config/redis');
const { generateToken } = require('../middleware/auth');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOtp = async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^\+91[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number. Use format: +91XXXXXXXXXX' });
  }

  const attempts = await redis.incr(`otp_attempts:${phone}`);
  if (attempts === 1) await redis.expire(`otp_attempts:${phone}`, 600);
  if (attempts > 5) {
    return res.status(429).json({ error: 'Too many OTP requests. Wait 10 minutes.' });
  }

  const otp = generateOtp();
  await setOtp(phone, otp);
  console.log(`📱 OTP for ${phone}: ${otp}`);

  res.json({ message: 'OTP sent successfully', phone });
};

const verifyOtp = async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required.' });
  }

  const storedOtp = await getOtp(phone);
  if (!storedOtp) {
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  if (storedOtp !== otp.toString()) {
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  }

  await deleteOtp(phone);
  await redis.del(`otp_attempts:${phone}`);

  const user = await prisma.user.upsert({
    where:  { phone },
    update: { updatedAt: new Date() },
    create: { phone, role: 'CUSTOMER' },
    select: { id: true, phone: true, name: true, role: true, photoUrl: true },
  });

  const token = generateToken(user.id);

  res.json({ message: 'Login successful', token, user });
};

const logout = async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data:  { fcmToken: null },
  });
  res.json({ message: 'Logged out successfully' });
};

const refreshToken = async (req, res) => {
  const token = generateToken(req.user.id);
  res.json({ token });
};

module.exports = { sendOtp, verifyOtp, logout, refreshToken };