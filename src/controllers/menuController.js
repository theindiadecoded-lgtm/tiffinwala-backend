// ─────────────────────────────────────────────
//  src/controllers/menuController.js
//  Handles menu item creation, editing, and
//  browsing by customers based on location.
// ─────────────────────────────────────────────

const prisma = require('../config/database');

// ════════════════════════════════════════════
//  GET /menus?lat=26.6&lng=84.9
//  Customer: browse all available tiffins near location.
//  Returns items with cook info, sorted by distance.
// ════════════════════════════════════════════
const getMenusNearby = async (req, res) => {
  const { lat, lng, category } = req.query;

  // Build filter conditions
  const where = {
    isAvailable: true,
    cook: { isActive: true },  // only from active cooks
  };

  if (category === 'veg')    where.type = 'VEG';
  if (category === 'nonveg') where.type = 'NON_VEG';

  const items = await prisma.menuItem.findMany({
    where,
    include: {
      cook: {
        select: { id: true, name: true, photoUrl: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,  // max 50 items per request
  });

  // Calculate average rating for each cook
  // In production: store denormalized avgRating on User table for performance
  const itemsWithRating = await Promise.all(
    items.map(async (item) => {
      const reviews = await prisma.review.aggregate({
        where:   { order: { cookId: item.cookId } },
        _avg:    { cookRating: true },
        _count:  true,
      });

      return {
        ...item,
        rating:      Math.round((reviews._avg.cookRating || 4.5) * 10) / 10,
        reviewCount: reviews._count,
        // Distance calculation (mock) — integrate Google Maps Distance Matrix API
        distanceKm: lat && lng ? (Math.random() * 3 + 0.5).toFixed(1) : null,
      };
    })
  );

  res.json({ items: itemsWithRating });
};

// ════════════════════════════════════════════
//  GET /menus/:cookId
//  Get all items from a specific cook.
// ════════════════════════════════════════════
const getCookMenu = async (req, res) => {
  const { cookId } = req.params;

  const cook = await prisma.user.findUnique({
    where:  { id: cookId, role: 'COOK' },
    select: { id: true, name: true, photoUrl: true, isActive: true },
  });

  if (!cook) return res.status(404).json({ error: 'Cook not found.' });

  const items = await prisma.menuItem.findMany({
    where:   { cookId, isAvailable: true },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ cook, items });
};

// ════════════════════════════════════════════
//  GET /cooks/me/menu
//  Cook: get their own menu (all items, including unavailable)
// ════════════════════════════════════════════
const getMyCookMenu = async (req, res) => {
  const items = await prisma.menuItem.findMany({
    where:   { cookId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
};

// ════════════════════════════════════════════
//  POST /cooks/me/menu
//  Cook: add a new menu item
//  Body: { name, price, type, maxDaily, description }
// ════════════════════════════════════════════
const addMenuItem = async (req, res) => {
  const { name, price, type, maxDaily, description, photoUrl } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required.' });
  }

  const item = await prisma.menuItem.create({
    data: {
      cookId:      req.user.id,
      name:        name.trim(),
      price:       parseInt(price),
      type:        type === 'NON_VEG' ? 'NON_VEG' : 'VEG',
      maxDaily:    parseInt(maxDaily) || 20,
      description: description?.trim(),
      photoUrl,
    },
  });

  res.status(201).json({ item, message: 'Menu item added successfully!' });
};

// ════════════════════════════════════════════
//  PUT /cooks/me/menu/:itemId
//  Cook: update item name, price, description
// ════════════════════════════════════════════
const updateMenuItem = async (req, res) => {
  const { itemId } = req.params;

  // Verify this item belongs to this cook
  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, cookId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

  const { name, price, description, maxDaily, photoUrl } = req.body;

  const item = await prisma.menuItem.update({
    where: { id: itemId },
    data:  {
      ...(name        && { name: name.trim() }),
      ...(price       && { price: parseInt(price) }),
      ...(description && { description: description.trim() }),
      ...(maxDaily    && { maxDaily: parseInt(maxDaily) }),
      ...(photoUrl    && { photoUrl }),
    },
  });

  res.json({ item, message: 'Menu item updated.' });
};

// ════════════════════════════════════════════
//  PATCH /cooks/me/menu/:itemId/toggle
//  Cook: toggle item available/unavailable for today
// ════════════════════════════════════════════
const toggleMenuItem = async (req, res) => {
  const { itemId } = req.params;

  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, cookId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

  const item = await prisma.menuItem.update({
    where: { id: itemId },
    data:  { isAvailable: !existing.isAvailable },
  });

  res.json({
    item,
    message: `Item is now ${item.isAvailable ? 'available' : 'unavailable'}.`,
  });
};

// ════════════════════════════════════════════
//  DELETE /cooks/me/menu/:itemId
//  Cook: permanently remove a menu item
// ════════════════════════════════════════════
const deleteMenuItem = async (req, res) => {
  const { itemId } = req.params;

  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, cookId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

  await prisma.menuItem.delete({ where: { id: itemId } });
  res.json({ message: 'Menu item deleted.' });
};

module.exports = {
  getMenusNearby, getCookMenu,
  getMyCookMenu, addMenuItem, updateMenuItem, toggleMenuItem, deleteMenuItem,
};
