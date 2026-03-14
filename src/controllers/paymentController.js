// ─────────────────────────────────────────────
//  src/controllers/paymentController.js
//  Razorpay payment flow:
//  1. createOrder → get razorpayOrderId
//  2. App opens Razorpay SDK with that ID
//  3. Customer pays → Razorpay calls our verifyPayment
//  4. We verify signature → mark order as paid
// ─────────────────────────────────────────────

const Razorpay  = require('razorpay');
const crypto    = require('crypto');
const prisma    = require('../config/database');

// Initialize Razorpay with your keys
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ════════════════════════════════════════════
//  POST /payments/create-order
//  Creates a Razorpay order for UPI payment.
//  Body: { orderId }   ← our internal order ID
//  Returns: { razorpayOrderId, amount, currency }
// ════════════════════════════════════════════
const createPaymentOrder = async (req, res) => {
  const { orderId } = req.body;

  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: req.user.id },
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (order.paymentMethod !== 'UPI') {
    return res.status(400).json({ error: 'This order uses cash on delivery.' });
  }

  // Create Razorpay order (amount is in paise: ₹60 = 6000 paise)
  const razorpayOrder = await razorpay.orders.create({
    amount:   order.total * 100,   // convert ₹ to paise
    currency: 'INR',
    receipt:  `tw_${orderId.slice(0, 20)}`,
    notes: {
      orderId,
      customerId: req.user.id,
      appName:    'TiffinWala',
    },
  });

  // Save Razorpay order ID to our payment record
  await prisma.payment.update({
    where: { orderId },
    data:  { razorpayOrderId: razorpayOrder.id },
  });

  res.json({
    razorpayOrderId: razorpayOrder.id,
    amount:          razorpayOrder.amount,
    currency:        razorpayOrder.currency,
    keyId:           process.env.RAZORPAY_KEY_ID,  // sent to app for SDK init
  });
};

// ════════════════════════════════════════════
//  POST /payments/verify
//  Called after Razorpay SDK completes payment.
//  Verifies the signature to confirm payment is genuine.
//  Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// ════════════════════════════════════════════
const verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // Verify signature: HMAC-SHA256(order_id + "|" + payment_id, secret)
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed. Invalid signature.' });
  }

  // Find payment record by Razorpay order ID
  const payment = await prisma.payment.findFirst({
    where: { razorpayOrderId: razorpay_order_id },
  });
  if (!payment) return res.status(404).json({ error: 'Payment record not found.' });

  // Mark payment as successful
  await prisma.payment.update({
    where: { id: payment.id },
    data:  {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      status:            'PAID',
      paidAt:            new Date(),
    },
  });

  res.json({ message: 'Payment verified successfully!' });
};

// ════════════════════════════════════════════
//  GET /cooks/me/earnings
//  Cook: get their earnings breakdown
// ════════════════════════════════════════════
const getCookEarnings = async (req, res) => {
  const { period = 'today' } = req.query;

  // Calculate date range based on period
  const now   = new Date();
  let   since = new Date();
  if (period === 'today')  since.setHours(0, 0, 0, 0);
  if (period === 'week')   since.setDate(now.getDate() - 7);
  if (period === 'month')  since.setDate(1);

  const earnings = await prisma.earning.findMany({
    where: { userId: req.user.id, role: 'COOK', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });

  const totalAmount  = earnings.reduce((sum, e) => sum + e.amount, 0);
  const pendingAmount = earnings.filter((e) => !e.isPaid).reduce((sum, e) => sum + e.amount, 0);

  res.json({
    earnings,
    summary: {
      total:   totalAmount,
      pending: pendingAmount,
      paid:    totalAmount - pendingAmount,
      orders:  earnings.length,
    },
  });
};

// ════════════════════════════════════════════
//  GET /riders/me/earnings
//  Rider: get their delivery earnings
// ════════════════════════════════════════════
const getRiderEarnings = async (req, res) => {
  const { period = 'today' } = req.query;

  const now   = new Date();
  let   since = new Date();
  if (period === 'today') since.setHours(0, 0, 0, 0);
  if (period === 'week')  since.setDate(now.getDate() - 7);
  if (period === 'month') since.setDate(1);

  const earnings = await prisma.earning.findMany({
    where:   { userId: req.user.id, role: 'RIDER', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });

  const total   = earnings.reduce((sum, e) => sum + e.amount, 0);
  const pending = earnings.filter((e) => !e.isPaid).reduce((sum, e) => sum + e.amount, 0);

  res.json({ earnings, summary: { total, pending, deliveries: earnings.length } });
};

// ════════════════════════════════════════════
//  POST /admin/payouts/approve
//  Admin: approve weekly payout to cook/rider
//  Body: { userId }
// ════════════════════════════════════════════
const approvePayout = async (req, res) => {
  const { userId } = req.body;

  // Mark all unpaid earnings as paid
  const result = await prisma.earning.updateMany({
    where: { userId, isPaid: false },
    data:  { isPaid: true, paidAt: new Date() },
  });

  // In production: trigger actual bank transfer via Razorpay Payouts API
  // await razorpay.payouts.create({ ... })

  res.json({ message: `Payout approved for ${result.count} earning records.` });
};

module.exports = {
  createPaymentOrder, verifyPayment,
  getCookEarnings, getRiderEarnings, approvePayout,
};
