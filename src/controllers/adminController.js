// ─────────────────────────────────────────────
//  src/controllers/adminController.js
//  Admin-only endpoints: dashboard stats,
//  managing cooks/riders, assigning deliveries.
// ─────────────────────────────────────────────

const prisma = require('../config/database');

// ════════════════════════════════════════════
//  GET /admin/dashboard
//  Returns today's key stats for the dashboard
// ════════════════════════════════════════════
const getDashboard = async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Run all queries in parallel for speed
  const [
    todayOrders,
    todayRevenue,
    activeCooks,
    activeRiders,
    pendingOrders,
    totalCustomers,
  ] = await Promise.all([
    // Total orders today
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),

    // Revenue today (sum of totals)
    prisma.order.aggregate({
      where:  { createdAt: { gte: todayStart }, status: { not: 'CANCELLED' } },
      _sum:   { total: true },
    }),

    // Cooks who are online (have location record and isOnline=true)
    prisma.user.count({
      where: { role: 'COOK', isActive: true, riderLocation: { isOnline: true } },
    }),

    // Riders currently on duty
    prisma.user.count({
      where: { role: 'RIDER', isActive: true, riderLocation: { isOnline: true } },
    }),

    // Orders waiting for action (PENDING or CONFIRMED)
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } } }),

    // Total registered customers
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
  ]);

  res.json({
    today: {
      orders:   todayOrders,
      revenue:  todayRevenue._sum.total || 0,
      pending:  pendingOrders,
    },
    total:   { customers: totalCustomers },
    active:  { cooks: activeCooks, riders: activeRiders },
  });
};

// ════════════════════════════════════════════
//  GET /admin/orders
//  All orders with optional filters
//  Query: ?status=PENDING&date=today&page=1
// ════════════════════════════════════════════
const getAllOrders = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const where = {};
  if (status) where.status = status.toUpperCase();

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        cook:     { select: { name: true, phone: true } },
        rider:    { select: { name: true, phone: true } },
        items:    { include: { menuItem: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip:  (parseInt(page) - 1) * parseInt(limit),
      take:  parseInt(limit),
    }),
    prisma.order.count({ where }),
  ]);

  res.json({ orders, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
};

// ════════════════════════════════════════════
//  POST /admin/cooks
//  Register a new cook
//  Body: { phone, name }
// ════════════════════════════════════════════
const registerCook = async (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Phone and name are required.' });

  const cook = await prisma.user.upsert({
    where:  { phone },
    update: { name, role: 'COOK' },
    create: { phone, name, role: 'COOK' },
    select: { id: true, phone: true, name: true, role: true },
  });

  res.status(201).json({ cook, message: 'Cook registered successfully!' });
};

// ════════════════════════════════════════════
//  POST /admin/riders
//  Register a new delivery rider
// ════════════════════════════════════════════
const registerRider = async (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Phone and name are required.' });

  const rider = await prisma.user.upsert({
    where:  { phone },
    update: { name, role: 'RIDER' },
    create: { phone, name, role: 'RIDER' },
    select: { id: true, phone: true, name: true, role: true },
  });

  res.status(201).json({ rider, message: 'Rider registered successfully!' });
};

// ════════════════════════════════════════════
//  PATCH /admin/orders/:id/assign-rider
//  Manually assign a rider to an order
//  Body: { riderId }
// ════════════════════════════════════════════
const assignRider = async (req, res) => {
  const { riderId }  = req.body;
  const { id: orderId } = req.params;

  const rider = await prisma.user.findFirst({ where: { id: riderId, role: 'RIDER' } });
  if (!rider) return res.status(404).json({ error: 'Rider not found.' });

  const order = await prisma.order.update({
    where: { id: orderId },
    data:  { riderId },
  });

  res.json({ order, message: `Order assigned to ${rider.name}.` });
};

// ════════════════════════════════════════════
//  GET /admin/revenue
//  Revenue report by period
//  Query: ?period=week | month | all
// ════════════════════════════════════════════
const getRevenue = async (req, res) => {
  const { period = 'week' } = req.query;

  const now   = new Date();
  let   since = new Date();
  if (period === 'week')  since.setDate(now.getDate() - 7);
  if (period === 'month') since.setDate(1);
  if (period === 'all')   since = new Date('2024-01-01');

  const result = await prisma.order.aggregate({
    where: { createdAt: { gte: since }, status: { not: 'CANCELLED' } },
    _sum:   { total: true, subtotal: true, gst: true },
    _count: true,
  });

  const cookPayouts  = await prisma.earning.aggregate({
    where: { role: 'COOK',  createdAt: { gte: since } },
    _sum:  { amount: true },
  });

  const riderPayouts = await prisma.earning.aggregate({
    where: { role: 'RIDER', createdAt: { gte: since } },
    _sum:  { amount: true },
  });

  const grossRevenue = result._sum.total || 0;
  const cookPayout   = cookPayouts._sum.amount  || 0;
  const riderPayout  = riderPayouts._sum.amount || 0;
  const profit       = grossRevenue - cookPayout - riderPayout;

  res.json({
    period,
    gross:      grossRevenue,
    cookPayout, riderPayout,
    profit,
    orders:     result._count,
  });
};

// ════════════════════════════════════════════
//  GET /admin/users
//  List all users with role filter
// ════════════════════════════════════════════
const getAllUsers = async (req, res) => {
  const { role, page = 1 } = req.query;
  const where = {};
  if (role) where.role = role.toUpperCase();

  const users = await prisma.user.findMany({
    where,
    select: { id: true, phone: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    skip: (parseInt(page) - 1) * 20,
    take: 20,
  });

  res.json({ users });
};

module.exports = {
  getDashboard, getAllOrders, getAllUsers,
  registerCook, registerRider,
  assignRider, getRevenue,
};
