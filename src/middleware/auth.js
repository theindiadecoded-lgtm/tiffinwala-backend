// ─────────────────────────────────────────────
//  src/middleware/auth.js
//  JWT authentication middleware.
//  Attach to any route that requires login.
//
//  Usage:
//    router.get('/protected', auth(), handler)
//    router.get('/admin-only', auth('ADMIN'), handler)
//    router.get('/cook-only',  auth('COOK'),  handler)
// ─────────────────────────────────────────────

const jwt     = require('jsonwebtoken');
const prisma  = require('../config/database');

// ── Main auth middleware factory ──
// Pass a role string to restrict to that role only
const auth = (requiredRole = null) => {
  return async (req, res, next) => {
    try {
      // 1. Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided. Please login.' });
      }

      const token = authHeader.split(' ')[1];

      // 2. Verify and decode JWT
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Session expired. Please login again.' });
        }
        return res.status(401).json({ error: 'Invalid token.' });
      }

      // 3. Load user from database (verify they still exist and are active)
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, phone: true, name: true, role: true, isActive: true },
      });

      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'User not found or deactivated.' });
      }

      // 4. Check role restriction if provided
      if (requiredRole && user.role !== requiredRole) {
        return res.status(403).json({
          error: `Access denied. This endpoint requires ${requiredRole} role.`,
        });
      }

      // 5. Attach user to request for use in controllers
      req.user = user;
      next();

    } catch (err) {
      console.error('Auth middleware error:', err);
      res.status(500).json({ error: 'Authentication failed.' });
    }
  };
};

// ── Helper: generate a new JWT token ──
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = { auth, generateToken };
