// ─────────────────────────────────────────────
//  src/socket/socketHandler.js
//  Real-time events via Socket.io.
//  Used for:
//   - Order status updates (customer sees live changes)
//   - Rider location updates (customer tracks on map)
//   - New order notifications (cook app buzzes)
//   - Pickup requests (rider app gets notified)
// ─────────────────────────────────────────────

const { setRiderLocation } = require('../config/redis');
const prisma = require('../config/database');

const initSocket = (io) => {

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── Join personal room on login ──
    // Client sends: socket.emit('authenticate', { userId })
    socket.on('authenticate', ({ userId }) => {
      socket.join(`user:${userId}`);
      console.log(`User ${userId} joined their personal room`);
    });

    // ── Join order room for tracking ──
    // Client sends: socket.emit('join_order', orderId)
    socket.on('join_order', (orderId) => {
      socket.join(`order:${orderId}`);
      console.log(`Socket joined order room: ${orderId}`);
    });

    // ── Leave order room ──
    socket.on('leave_order', (orderId) => {
      socket.leave(`order:${orderId}`);
    });

    // ── Rider location update ──
    // Rider app sends location every 5 seconds while delivering
    // Client sends: socket.emit('rider_location', { riderId, latitude, longitude, orderId })
    socket.on('rider_location', async ({ riderId, latitude, longitude, orderId }) => {
      // Cache in Redis (fast)
      await setRiderLocation(riderId, latitude, longitude);

      // Update DB every 30 seconds (not every 5s — saves DB writes)
      const now = Date.now();
      if (!socket.lastDbUpdate || now - socket.lastDbUpdate > 30000) {
        socket.lastDbUpdate = now;
        await prisma.riderLocation.upsert({
          where:  { riderId },
          update: { latitude, longitude },
          create: { riderId, latitude, longitude, isOnline: true },
        }).catch(() => {});  // fail silently
      }

      // Forward location to customer tracking this order
      if (orderId) {
        io.to(`order:${orderId}`).emit('rider_location_update', {
          orderId, latitude, longitude, updatedAt: new Date(),
        });
      }
    });

    // ── ETA update (sent by server when calculating new ETA) ──
    socket.on('request_eta', async ({ orderId }) => {
      // In production: use Google Maps Distance Matrix API
      // For now: mock ETA
      const eta = Math.floor(Math.random() * 20) + 10;
      io.to(`order:${orderId}`).emit('eta_update', { orderId, etaMinutes: eta });
    });

    // ── Cook availability status ──
    socket.on('cook_status', async ({ cookId, isOnline }) => {
      await prisma.riderLocation.upsert({
        where:  { riderId: cookId },
        update: { isOnline },
        create: { riderId: cookId, latitude: 0, longitude: 0, isOnline },
      }).catch(() => {});
    });

    // ── Disconnect handling ──
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });
};

module.exports = { initSocket };
