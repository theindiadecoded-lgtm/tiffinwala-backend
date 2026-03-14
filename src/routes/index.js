// ─────────────────────────────────────────────
//  src/routes/index.js
//  All API routes wired to their controllers.
//  Mounted at /api in server.js
// ─────────────────────────────────────────────

const express = require('express');
const router  = express.Router();

const { auth }             = require('../middleware/auth');
const { asyncHandler }     = require('../middleware/errorHandler');

const authCtrl    = require('../controllers/authController');
const menuCtrl    = require('../controllers/menuController');
const orderCtrl   = require('../controllers/orderController');
const paymentCtrl = require('../controllers/paymentController');
const adminCtrl   = require('../controllers/adminController');
const prisma      = require('../config/database');
const { setRiderLocation, getRiderLocation } = require('../config/redis');

// ════════════════════════════════════════════
//  AUTH ROUTES  — no auth needed
// ════════════════════════════════════════════
router.post('/auth/send-otp',   asyncHandler(authCtrl.sendOtp));
router.post('/auth/verify-otp', asyncHandler(authCtrl.verifyOtp));
router.post('/auth/refresh',    auth(), asyncHandler(authCtrl.refreshToken));
router.post('/auth/logout',     auth(), asyncHandler(authCtrl.logout));

// ════════════════════════════════════════════
//  USER / PROFILE ROUTES
// ════════════════════════════════════════════
router.get('/users/me', auth(), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where:  { id: req.user.id },
    select: { id: true, phone: true, name: true, role: true, photoUrl: true, createdAt: true },
  });
  res.json({ user });
}));

router.put('/users/me', auth(), asyncHandler(async (req, res) => {
  const { name, photoUrl } = req.body;
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data:  { ...(name && { name }), ...(photoUrl && { photoUrl }) },
    select: { id: true, name: true, photoUrl: true },
  });
  res.json({ user, message: 'Profile updated.' });
}));

router.post('/users/address', auth(), asyncHandler(async (req, res) => {
  const { label, line1, area, city, pincode, lat, lng, isDefault } = req.body;
  if (!line1 || !area || !pincode) return res.status(400).json({ error: 'Address fields required.' });

  if (isDefault) {
    await prisma.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
  }

  const address = await prisma.address.create({
    data: { userId: req.user.id, label: label || 'Home', line1, area, city: city || 'Motihari', pincode, lat, lng, isDefault: !!isDefault },
  });
  res.status(201).json({ address });
}));

router.get('/users/addresses', auth(), asyncHandler(async (req, res) => {
  const addresses = await prisma.address.findMany({ where: { userId: req.user.id } });
  res.json({ addresses });
}));

// ════════════════════════════════════════════
//  MENU ROUTES
// ════════════════════════════════════════════
router.get('/menus',                      asyncHandler(menuCtrl.getMenusNearby));
router.get('/menus/:cookId',              asyncHandler(menuCtrl.getCookMenu));
router.get('/cooks/me/menu',              auth('COOK'), asyncHandler(menuCtrl.getMyCookMenu));
router.post('/cooks/me/menu',             auth('COOK'), asyncHandler(menuCtrl.addMenuItem));
router.put('/cooks/me/menu/:itemId',      auth('COOK'), asyncHandler(menuCtrl.updateMenuItem));
router.patch('/cooks/me/menu/:itemId/toggle', auth('COOK'), asyncHandler(menuCtrl.toggleMenuItem));
router.delete('/cooks/me/menu/:itemId',   auth('COOK'), asyncHandler(menuCtrl.deleteMenuItem));

// Cook availability toggle
router.patch('/cooks/me/availability', auth('COOK'), asyncHandler(async (req, res) => {
  const { isOnline } = req.body;
  await prisma.riderLocation.upsert({
    where:  { riderId: req.user.id },
    update: { isOnline },
    create: { riderId: req.user.id, latitude: 0, longitude: 0, isOnline },
  });
  res.json({ message: `Shop is now ${isOnline ? 'open' : 'closed'}.` });
}));

// ════════════════════════════════════════════
//  ORDER ROUTES
// ════════════════════════════════════════════
router.post('/orders',               auth('CUSTOMER'), asyncHandler(orderCtrl.placeOrder));
router.get('/orders/my',             auth(),           asyncHandler(orderCtrl.getMyOrders));
router.get('/orders/:orderId',       auth(),           asyncHandler(orderCtrl.getOrderById));
router.get('/cooks/me/orders',       auth('COOK'),     asyncHandler(orderCtrl.getCookOrders));
router.patch('/orders/:id/accept',   auth('COOK'),     asyncHandler(orderCtrl.acceptOrder));
router.patch('/orders/:id/ready',    auth('COOK'),     asyncHandler(orderCtrl.markReady));
router.patch('/orders/:id/reject',   auth('COOK'),     asyncHandler(orderCtrl.rejectOrder));
router.get('/riders/me/orders',      auth('RIDER'),    asyncHandler(orderCtrl.getRiderOrders));
router.patch('/orders/:id/picked-up', auth('RIDER'),   asyncHandler(orderCtrl.markPickedUp));
router.patch('/orders/:id/delivered', auth('RIDER'),   asyncHandler(orderCtrl.markDelivered));

// Live rider location tracking
router.post('/riders/me/location', auth('RIDER'), asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;
  await setRiderLocation(req.user.id, latitude, longitude);
  await prisma.riderLocation.upsert({
    where:  { riderId: req.user.id },
    update: { latitude, longitude, updatedAt: new Date() },
    create: { riderId: req.user.id, latitude, longitude, isOnline: true },
  });
  res.json({ message: 'Location updated.' });
}));

router.get('/orders/:orderId/track', auth(), asyncHandler(async (req, res) => {
  const order    = await prisma.order.findUnique({ where: { id: req.params.orderId } });
  if (!order?.riderId) return res.json({ location: null });
  const location = await getRiderLocation(order.riderId);
  res.json({ location });
}));

// Rider availability toggle
router.patch('/riders/me/availability', auth('RIDER'), asyncHandler(async (req, res) => {
  const { isOnline } = req.body;
  await prisma.riderLocation.upsert({
    where:  { riderId: req.user.id },
    update: { isOnline },
    create: { riderId: req.user.id, latitude: 0, longitude: 0, isOnline },
  });
  res.json({ message: `You are now ${isOnline ? 'online' : 'offline'}.` });
}));

// ════════════════════════════════════════════
//  PAYMENT ROUTES
// ════════════════════════════════════════════
router.post('/payments/create-order', auth('CUSTOMER'), asyncHandler(paymentCtrl.createPaymentOrder));
router.post('/payments/verify',       auth('CUSTOMER'), asyncHandler(paymentCtrl.verifyPayment));
router.get('/cooks/me/earnings',      auth('COOK'),     asyncHandler(paymentCtrl.getCookEarnings));
router.get('/riders/me/earnings',     auth('RIDER'),    asyncHandler(paymentCtrl.getRiderEarnings));

// ════════════════════════════════════════════
//  SUBSCRIPTION ROUTES
// ════════════════════════════════════════════
router.get('/subscriptions/plans', asyncHandler(async (req, res) => {
  res.json({ plans: [
    { id: '5day',    name: '5-Day Plan',    price: 599, originalPrice: 750, desc: 'Mon–Fri · Lunch + Dinner' },
    { id: 'monthly', name: 'Monthly Plan',  price: 1999, originalPrice: 2500, desc: '30 days · Lunch + Dinner' },
  ]});
}));

router.post('/subscriptions', auth('CUSTOMER'), asyncHandler(async (req, res) => {
  const { planType } = req.body;
  const plans = { FIVE_DAY: { days: 5, amount: 599 }, MONTHLY: { days: 30, amount: 1999 } };
  const plan  = plans[planType?.toUpperCase()];
  if (!plan) return res.status(400).json({ error: 'Invalid plan type.' });

  const start = new Date();
  const end   = new Date();
  end.setDate(end.getDate() + plan.days);

  const sub = await prisma.subscription.create({
    data: { customerId: req.user.id, planType: planType.toUpperCase(), startDate: start, endDate: end, amount: plan.amount },
  });
  res.status(201).json({ subscription: sub });
}));

router.get('/subscriptions/my', auth('CUSTOMER'), asyncHandler(async (req, res) => {
  const sub = await prisma.subscription.findFirst({
    where: { customerId: req.user.id, isActive: true, endDate: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ subscription: sub });
}));

router.delete('/subscriptions/:id', auth('CUSTOMER'), asyncHandler(async (req, res) => {
  await prisma.subscription.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ message: 'Subscription cancelled.' });
}));

// ════════════════════════════════════════════
//  ADMIN ROUTES  (ADMIN role only)
// ════════════════════════════════════════════
router.get('/admin/dashboard',           auth('ADMIN'), asyncHandler(adminCtrl.getDashboard));
router.get('/admin/orders',              auth('ADMIN'), asyncHandler(adminCtrl.getAllOrders));
router.get('/admin/users',               auth('ADMIN'), asyncHandler(adminCtrl.getAllUsers));
router.post('/admin/cooks',              auth('ADMIN'), asyncHandler(adminCtrl.registerCook));
router.post('/admin/riders',             auth('ADMIN'), asyncHandler(adminCtrl.registerRider));
router.patch('/admin/orders/:id/assign-rider', auth('ADMIN'), asyncHandler(adminCtrl.assignRider));
router.get('/admin/revenue',             auth('ADMIN'), asyncHandler(adminCtrl.getRevenue));
router.post('/admin/payouts/approve',    auth('ADMIN'), asyncHandler(paymentCtrl.approvePayout));

// ── Health check ──
router.get('/health', (req, res) => res.json({ status: 'ok', app: 'TiffinWala API', time: new Date() }));

module.exports = router;
