// ─────────────────────────────────────────────
//  src/middleware/errorHandler.js
//  Global error handler — catches any error
//  thrown in controllers and returns clean JSON.
// ─────────────────────────────────────────────

const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Prisma: record not found
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }

  // Prisma: unique constraint violation (e.g. duplicate phone)
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this value already exists.' });
  }

  // Zod: validation error
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }

  // JWT: auth errors (shouldn't reach here but just in case)
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token.' });
  }

  // Default: internal server error
  res.status(err.status || 500).json({
    error: err.message || 'Something went wrong. Please try again.',
  });
};

// ── Wrapper to catch async errors without try/catch in every controller ──
// Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
