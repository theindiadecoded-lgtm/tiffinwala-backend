// ─────────────────────────────────────────────
//  src/controllers/orderController.js
//  Handles the entire order lifecycle:
//  Place → Confirm → Prepare → Ready → Pickup → Deliver
//  Each status change emits a Socket.io event.
// ─────────────────────────────────────────────

const prisma  = require('../config/database');
const { setOrderStatus } = require('../config/redis');

// ── Helper: emit Socket.io event to relevant rooms ──
// getIO() is set after server starts (see server.js)
let io;
const setIO = (socketIO) => { io = socketIO; };

const emitOrderUpdate = (orderId, customerId, cookId, riderId, event, data) => {
  if (!io) return;
  // Notify customer, cook, and rider (if assigned) about the update
  io.to(`order:${orderId}`).emit(event, data);
  io.to(`user:${customerId}`).emit(event, data);
  io.to(`user:${cookId}`).emit(event, data);
  if (riderId) io.to(`user:${riderId}`).emit(event, data);
};

// ════════════════════════════════════════════
//  POST /orders
//  Customer places a new order.
//  Body: { items: [{menuItemId, quantity}], addressId, paymentMethod, note }
// ════════════════════════════════════════════
const placeOrder = async (req, res) => {
  const { items, addressId, paymentMethod = 'UPI', note } = req.body;

  if (!items?.length) return res.status(400).json({ error: 'Order must have at least one item.' });

  // 1. Load all menu items to get prices and cook ID
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems   = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, isAvailable: true },
  });

  if (menuItems.length !== items.length) {
    return res.status(400).json({ error: 'One or more items are unavailable.' });
  }

  // 2. Verify all items from same cook (can't mix cooks in one order)
  const cookIds = [...new Set(menuItems.map((m) => m.cookId))];
  if (cookIds.length > 1) {
    return res.status(400).json({ error: 'All items must be from the same cook.' });
  }
  const cookId = cookIds[0];

  // 3. Verify address belongs to this customer
  const address = await prisma.address.findFirst({
    where: { id: addressId, userId: req.user.id },
  });
  if (!address) return res.status(400).json({ error: 'Invalid delivery address.' });

  // 4. Calculate totals
  const orderItems = items.map((i) => {
    const menuItem = menuItems.find((m) => m.id === i.menuItemId);
    return {
      menuItemId: i.menuItemId,
      quantity:   i.quantity,
      unitPrice:  menuItem.price,   // snapshot price
    };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const gst      = Math.round(subtotal * 0.05);
  const total    = subtotal + gst;

  // 5. Create order in database (transaction ensures atomicity)
  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        customerId:    req.user.id,
        cookId,
        addressId,
        paymentMethod: paymentMethod.toUpperCase(),
        subtotal,
        gst,
        total,
        note,
        items: { create: orderItems },
      },
      include: {
        items:    { include: { menuItem: true } },
        customer: { select: { name: true, phone: true } },
        cook:     { select: { name: true, phone: true } },
        address:  true,
      },
    });

    // Create pending payment record
    await tx.payment.create({
      data: {
        orderId: newOrder.id,
        userId:  req.user.id,
        amount:  total,
        method:  paymentMethod.toUpperCase(),
        status:  paymentMethod === 'CASH' ? 'PENDING' : 'PENDING',
      },
    });

    return newOrder;
  });

  // 6. Cache status in Redis for fast reads
  await setOrderStatus(order.id, 'PENDING');

  // 7. Notify cook via Socket.io about new order
  emitOrderUpdate(order.id, req.user.id, cookId, null, 'new_order', {
    orderId:  order.id,
    customer: order.customer,
    items:    order.items,
    total,
    address:  order.address,
  });

  res.status(201).json({ order, message: 'Order placed successfully!' });
};

// ════════════════════════════════════════════
//  GET /orders/my
//  Customer: get their order history
// ════════════════════════════════════════════
const getMyOrders = async (req, res) => {
  const orders = await prisma.order.findMany({
    where:   { customerId: req.user.id },
    include: {
      items:  { include: { menuItem: { select: { name: true } } } },
      cook:   { select: { name: true } },
      review: true,
    },
    orderBy: { createdAt: 'desc' },
    take:    20,
  });
  res.json({ orders });
};

// ════════════════════════════════════════════
//  GET /orders/:orderId
//  Any role: get full order details
// ════════════════════════════════════════════
const getOrderById = async (req, res) => {
  const order = await prisma.order.findUnique({
    where:   { id: req.params.orderId },
    include: {
      items:    { include: { menuItem: true } },
      customer: { select: { name: true, phone: true } },
      cook:     { select: { name: true, phone: true } },
      rider:    { select: { name: true, phone: true } },
      address:  true,
      payment:  true,
    },
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order });
};

// ════════════════════════════════════════════
//  GET /cooks/me/orders
//  Cook: get incoming orders for their kitchen
// ════════════════════════════════════════════
const getCookOrders = async (req, res) => {
  const { status } = req.query;
  const where = { cookId: req.user.id };
  if (status) where.status = status.toUpperCase();
  else where.status = { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] };

  const orders = await prisma.order.findMany({
    where,
    include: {
      items:    { include: { menuItem: true } },
      customer: { select: { name: true, phone: true } },
      address:  true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ orders });
};

// ════════════════════════════════════════════
//  PATCH /orders/:id/accept
//  Cook accepts the order → status: CONFIRMED
// ════════════════════════════════════════════
const acceptOrder = async (req, res) => {
  const order = await updateOrderStatus(req.params.id, req.user.id, 'cookId', 'PENDING', 'CONFIRMED');
  emitOrderUpdate(order.id, order.customerId, order.cookId, order.riderId,
    'order_status_update', { orderId: order.id, status: 'CONFIRMED' });
  res.json({ order, message: 'Order accepted! Start preparing.' });
};

// ════════════════════════════════════════════
//  PATCH /orders/:id/ready
//  Cook marks food ready → status: READY
//  System auto-assigns nearest available rider
// ════════════════════════════════════════════
const markReady = async (req, res) => {
  const order = await updateOrderStatus(req.params.id, req.user.id, 'cookId', 'CONFIRMED', 'READY');

  // Auto-assign nearest online rider
  const rider = await prisma.user.findFirst({
    where: { role: 'RIDER', isActive: true,
      riderLocation: { isOnline: true } },
  });

  let updatedOrder = order;
  if (rider) {
    updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data:  { riderId: rider.id },
    });
    // Notify rider about pickup request
    io?.to(`user:${rider.id}`).emit('new_pickup', {
      orderId:  order.id,
      cookName: req.user.name,
      address:  order.address,
    });
  }

  emitOrderUpdate(order.id, order.customerId, order.cookId, rider?.id,
    'order_status_update', { orderId: order.id, status: 'READY' });
  res.json({ order: updatedOrder, message: 'Food is ready! Rider notified.' });
};

// ════════════════════════════════════════════
//  PATCH /orders/:id/reject
//  Cook rejects the order → status: CANCELLED
// ════════════════════════════════════════════
const rejectOrder = async (req, res) => {
  const order = await updateOrderStatus(req.params.id, req.user.id, 'cookId', 'PENDING', 'CANCELLED');
  emitOrderUpdate(order.id, order.customerId, order.cookId, null,
    'order_status_update', { orderId: order.id, status: 'CANCELLED', reason: 'Cook unavailable' });
  res.json({ message: 'Order rejected.' });
};

// ════════════════════════════════════════════
//  GET /riders/me/orders
//  Rider: get their assigned deliveries
// ════════════════════════════════════════════
const getRiderOrders = async (req, res) => {
  const orders = await prisma.order.findMany({
    where:   { riderId: req.user.id, status: { in: ['READY', 'PICKED_UP'] } },
    include: {
      items:    { include: { menuItem: { select: { name: true } } } },
      customer: { select: { name: true, phone: true } },
      cook:     { select: { name: true, phone: true } },
      address:  true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ orders });
};

// ════════════════════════════════════════════
//  PATCH /orders/:id/picked-up
//  Rider picks up food from cook → PICKED_UP
// ════════════════════════════════════════════
const markPickedUp = async (req, res) => {
  const order = await updateOrderStatus(req.params.id, req.user.id, 'riderId', 'READY', 'PICKED_UP');
  emitOrderUpdate(order.id, order.customerId, order.cookId, order.riderId,
    'order_status_update', { orderId: order.id, status: 'PICKED_UP' });
  res.json({ order, message: 'Food picked up. On the way!' });
};

// ════════════════════════════════════════════
//  PATCH /orders/:id/delivered
//  Rider marks as delivered → DELIVERED
//  Creates earning records for cook and rider
// ════════════════════════════════════════════
const markDelivered = async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  if (!order || order.riderId !== req.user.id || order.status !== 'PICKED_UP') {
    return res.status(400).json({ error: 'Cannot mark this order as delivered.' });
  }

  await prisma.$transaction(async (tx) => {
    // Update order status
    await tx.order.update({
      where: { id: order.id },
      data:  { status: 'DELIVERED', deliveredAt: new Date() },
    });

    // Cook earns 85% of subtotal
    await tx.earning.create({
      data: { userId: order.cookId, role: 'COOK',  orderId: order.id, amount: Math.round(order.subtotal * 0.85) },
    });

    // Rider earns ₹30-70 per delivery (based on distance — simplified here)
    await tx.earning.create({
      data: { userId: order.riderId, role: 'RIDER', orderId: order.id, amount: 60 },
    });

    // Mark payment as PAID for cash orders
    if (order.paymentMethod === 'CASH') {
      await tx.payment.update({
        where: { orderId: order.id },
        data:  { status: 'PAID', paidAt: new Date() },
      });
    }
  });

  await setOrderStatus(order.id, 'DELIVERED');
  emitOrderUpdate(order.id, order.customerId, order.cookId, order.riderId,
    'order_status_update', { orderId: order.id, status: 'DELIVERED' });

  res.json({ message: 'Order delivered successfully! Great job.' });
};

// ── Internal helper: update order status with validation ──
const updateOrderStatus = async (orderId, userId, userField, fromStatus, toStatus) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw { status: 404, message: 'Order not found.' };
  if (order[userField] !== userId) throw { status: 403, message: 'Not authorized for this order.' };
  if (order.status !== fromStatus) throw { status: 400, message: `Order must be in ${fromStatus} status.` };

  const updated = await prisma.order.update({
    where: { id: orderId },
    data:  { status: toStatus },
    include: { address: true },
  });
  await setOrderStatus(orderId, toStatus);
  return updated;
};

module.exports = {
  setIO,
  placeOrder, getMyOrders, getOrderById,
  getCookOrders, acceptOrder, markReady, rejectOrder,
  getRiderOrders, markPickedUp, markDelivered,
};
