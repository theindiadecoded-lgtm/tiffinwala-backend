// ─────────────────────────────────────────────
//  src/config/database.js
//  Exports a single shared Prisma client instance.
//  Using a singleton prevents connection pool exhaustion
//  during hot-reloads in development.
// ─────────────────────────────────────────────

const { PrismaClient } = require('@prisma/client');

// In development, store prisma on globalThis to avoid
// creating a new instance on every hot-reload
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']   // log SQL queries in dev
      : ['error'],                    // only errors in production
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
