# 🍱 TiffinWala — Backend API Server
### Node.js + Express + PostgreSQL + Socket.io · Motihari, Bihar

---

## 📁 Project Structure

```
TiffinWala-Backend/
├── server.js                      ← Entry point — starts everything
├── package.json
├── .env.example                   ← Copy to .env and fill in values
├── prisma/
│   └── schema.prisma              ← Database tables (8 tables)
└── src/
    ├── config/
    │   ├── database.js            ← Prisma client (PostgreSQL)
    │   └── redis.js               ← Redis client + helpers
    ├── middleware/
    │   ├── auth.js                ← JWT verification
    │   └── errorHandler.js        ← Global error handler
    ├── controllers/
    │   ├── authController.js      ← OTP send/verify/logout
    │   ├── menuController.js      ← Tiffin menu CRUD
    │   ├── orderController.js     ← Full order lifecycle
    │   ├── paymentController.js   ← Razorpay + earnings
    │   └── adminController.js     ← Dashboard + management
    ├── routes/
    │   └── index.js               ← All 45 API endpoints
    └── socket/
        └── socketHandler.js       ← Real-time Socket.io events
```

---

## 🚀 Setup Instructions

### Step 1 — Install Node.js 20
Download: https://nodejs.org

### Step 2 — Install dependencies
```bash
cd TiffinWala-Backend
npm install
```

### Step 3 — Set up PostgreSQL (Supabase — FREE)
1. Go to https://supabase.com → Create free account
2. New Project → name it "tiffinwala"
3. Go to Settings → Database → copy "Connection string (URI)"
4. Paste in `.env` as `DATABASE_URL`

### Step 4 — Set up Redis (Upstash — FREE)
1. Go to https://console.upstash.com → Create free account
2. Create Database → name "tiffinwala-cache"
3. Copy "Redis URL" → paste in `.env` as `REDIS_URL`

### Step 5 — Configure environment
```bash
cp .env.example .env
# Then edit .env with your actual values
```

### Step 6 — Create database tables
```bash
npx prisma generate    # generates Prisma client
npx prisma migrate dev # creates all 8 tables in your database
```

### Step 7 — Start the server
```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Server starts at: http://localhost:3000

---

## 🔑 Environment Variables (Important!)

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Supabase → Settings → Database |
| `REDIS_URL` | Upstash → Your database → URL |
| `JWT_SECRET` | Any random long string |
| `RAZORPAY_KEY_ID` | razorpay.com → Dashboard → API Keys |
| `RAZORPAY_KEY_SECRET` | razorpay.com → Dashboard → API Keys |
| `FAST2SMS_API_KEY` | fast2sms.com (SMS OTP) |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings |

---

## 📡 API Endpoints (45 total)

### Auth
| Method | Endpoint | Who |
|--------|----------|-----|
| POST | `/api/auth/send-otp` | All |
| POST | `/api/auth/verify-otp` | All |
| POST | `/api/auth/refresh` | All |
| POST | `/api/auth/logout` | All |

### Orders
| Method | Endpoint | Who |
|--------|----------|-----|
| POST | `/api/orders` | Customer |
| GET | `/api/orders/my` | Customer |
| GET | `/api/orders/:id` | All |
| GET | `/api/cooks/me/orders` | Cook |
| PATCH | `/api/orders/:id/accept` | Cook |
| PATCH | `/api/orders/:id/ready` | Cook |
| PATCH | `/api/orders/:id/reject` | Cook |
| GET | `/api/riders/me/orders` | Rider |
| PATCH | `/api/orders/:id/picked-up` | Rider |
| PATCH | `/api/orders/:id/delivered` | Rider |

### Full list in `src/routes/index.js`

---

## ⚡ Real-time Socket.io Events

| Event (client → server) | Purpose |
|--------------------------|---------|
| `authenticate` | Join personal notification room |
| `join_order` | Track a specific order |
| `rider_location` | Rider sends GPS every 5 seconds |

| Event (server → client) | Purpose |
|--------------------------|---------|
| `order_status_update` | Status changed (CONFIRMED, READY etc.) |
| `rider_location_update` | New rider coordinates |
| `new_order` | Cook notified of incoming order |
| `new_pickup` | Rider notified of pickup request |
| `eta_update` | New estimated arrival time |

---

## 🗄️ Database Tables

| Table | Purpose |
|-------|---------|
| `users` | All users (customer/cook/rider/admin) |
| `addresses` | Customer delivery addresses |
| `menu_items` | Cook's tiffin offerings |
| `orders` | Core order record |
| `order_items` | Items within an order |
| `payments` | Razorpay transactions |
| `rider_locations` | Live GPS positions |
| `subscriptions` | Weekly/monthly plans |
| `reviews` | Ratings after delivery |
| `earnings` | Cook/rider payout tracking |

---

## 🚢 Deploy to Railway (Free Hosting)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "TiffinWala backend v1"
git push origin main
```

### Step 2 — Deploy on Railway
1. Go to https://railway.app → Sign in with GitHub
2. New Project → Deploy from GitHub repo
3. Add all `.env` variables in Railway dashboard
4. Railway auto-deploys on every push!

### Step 3 — Run migrations on production
In Railway console:
```bash
npx prisma migrate deploy
```

### Step 4 — Update Customer App
In `TiffinWala-Customer/src/api/api.js`:
```js
export const BASE_URL = 'https://your-app.railway.app/api';
```

---

## 🧪 Test the API

Once server is running, test with:

```bash
# Health check
curl http://localhost:3000/api/health

# Send OTP (in dev mode, OTP prints to terminal)
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210"}'

# Verify OTP (check terminal for OTP code)
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210", "otp": "123456"}'
```

Use Postman or Insomnia for full API testing.

---

## 🔗 Connected Apps

| App | Uses these APIs |
|-----|----------------|
| Customer App | auth, menus, orders, payments, subscriptions |
| Cook App | auth, menus, orders (accept/ready/reject) |
| Rider App | auth, orders (pickup/deliver), location |
| Admin Panel | All admin routes, dashboard, revenue |

---

## 💰 Monthly Server Costs

| Service | Cost |
|---------|------|
| Railway (hosting) | Free → ₹400/mo paid |
| Supabase (database) | Free tier |
| Upstash (Redis) | Free tier |
| Fast2SMS (OTP) | ~₹1/OTP |
| Razorpay | 2% per transaction |
| Total to start | ~₹0/month |
"# tiffinwala-backend" 
"# tiffinbackend" 
