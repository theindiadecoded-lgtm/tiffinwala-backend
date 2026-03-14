// ─────────────────────────────────────────────
//  src/config/redis.js
//  Redis client using ioredis.
//  Used for:
//   - Caching live order statuses (fast reads)
//   - Storing OTP codes temporarily (expire in 5 min)
//   - Rider location cache (updated every 5 seconds)
//   - Rate limiting (via express-rate-limit)
// ─────────────────────────────────────────────

const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck:     true,
  retryStrategy(times) {
    // Retry with exponential backoff, max 10 seconds
    const delay = Math.min(times * 200, 10000);
    return delay;
  },
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error',   (err) => console.error('❌ Redis error:', err.message));

// ── Helper: store OTP with 5 minute expiry ──
const setOtp = async (phone, otp) => {
  await redis.setex(`otp:${phone}`, 300, otp);  // 300 seconds = 5 minutes
};

// ── Helper: get stored OTP ──
const getOtp = async (phone) => {
  return redis.get(`otp:${phone}`);
};

// ── Helper: delete OTP after successful verify ──
const deleteOtp = async (phone) => {
  await redis.del(`otp:${phone}`);
};

// ── Helper: cache order status ──
const setOrderStatus = async (orderId, status) => {
  await redis.setex(`order:${orderId}:status`, 3600, status);  // 1 hour TTL
};

const getOrderStatus = async (orderId) => {
  return redis.get(`order:${orderId}:status`);
};

// ── Helper: cache rider location ──
const setRiderLocation = async (riderId, lat, lng) => {
  await redis.setex(
    `rider:${riderId}:location`,
    30,                              // expire in 30 seconds (rider must keep updating)
    JSON.stringify({ lat, lng, updatedAt: Date.now() })
  );
};

const getRiderLocation = async (riderId) => {
  const data = await redis.get(`rider:${riderId}:location`);
  return data ? JSON.parse(data) : null;
};

module.exports = {
  redis,
  setOtp, getOtp, deleteOtp,
  setOrderStatus, getOrderStatus,
  setRiderLocation, getRiderLocation,
};
