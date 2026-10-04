const Coupon = require('../models/Coupon');
const asyncHandler = require('../middleware/asyncHandler');
const Product = require('../models/Product');
const { calculateOrderTotals } = require('../utils/orderPricing');

const fields = ['code', 'discountPercent', 'minOrderValue', 'expiresAt', 'active'];
function couponData(body) {
  return Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

exports.validateCoupon = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const items = req.body.items;
  if (!code || !Array.isArray(items) || !items.length || items.length > 50) return res.status(400).json({ message: 'Enter a coupon code and cart items.' });
  const quantities = new Map();
  for (const item of items) {
    const id = String(item.product || '');
    const qty = Number.parseInt(item.qty, 10);
    if (!/^[a-f\d]{24}$/i.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ message: 'A cart item or quantity is invalid.' });
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }
  if ([...quantities.values()].some((qty) => qty > 20)) return res.status(400).json({ message: 'A product quantity cannot exceed 20.' });
  const products = await Product.find({ _id: { $in: [...quantities.keys()] } });
  if (products.length !== quantities.size) return res.status(400).json({ message: 'One or more cart products are unavailable.' });
  const pricedItems = products.map((product) => ({ product: product._id, price: product.price, qty: quantities.get(String(product._id)) }));
  const subtotal = pricedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const coupon = await Coupon.findOne({ code, active: true, expiresAt: { $gt: new Date() } });
  if (!coupon) return res.status(400).json({ message: 'Coupon is invalid or expired.' });
  if (subtotal < coupon.minOrderValue) return res.status(400).json({ message: `This coupon requires a minimum order of ₹${coupon.minOrderValue}.` });
  const totals = calculateOrderTotals(pricedItems, coupon);
  res.json({ code: coupon.code, discountPrice: totals.discountPrice, totalPrice: totals.totalPrice });
});

exports.bulkUpdateStock = asyncHandler(async (req, res) => {
  const updates = req.body.updates;
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 100) {
    return res.status(400).json({ message: 'Provide 1 to 100 inventory updates.' });
  }
  const ids = new Set();
  for (const item of updates) {
    if (!/^[a-f\d]{24}$/i.test(String(item.id)) || ids.has(String(item.id)) || !Number.isInteger(item.countInStock) || item.countInStock < 0 || item.countInStock > 100000) {
      return res.status(400).json({ message: 'Each inventory update must have a unique product ID and stock from 0 to 100000.' });
    }
    ids.add(String(item.id));
  }
  const result = await Product.bulkWrite(updates.map((item) => ({ updateOne: { filter: { _id: item.id }, update: { $set: { countInStock: item.countInStock } } } })));
  if (result.matchedCount !== updates.length) return res.status(404).json({ message: 'One or more products were not found.' });
  res.json({ message: `Updated inventory for ${result.modifiedCount} product(s).` });
});

exports.listCoupons = asyncHandler(async (req, res) => {
  res.json(await Coupon.find().sort({ createdAt: -1 }));
});

exports.createCoupon = asyncHandler(async (req, res) => {
  const data = couponData(req.body);
  data.code = String(data.code || '').trim().toUpperCase();
  if (!data.code || !data.expiresAt || data.discountPercent === undefined) {
    return res.status(400).json({ message: 'Coupon code, discount and expiry date are required.' });
  }
  if (!/^[A-Z0-9_-]{2,30}$/.test(data.code)) return res.status(400).json({ message: 'Coupon codes must be 2–30 characters using letters, numbers, underscores or hyphens.' });
  res.status(201).json(await Coupon.create(data));
});

exports.updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, couponData(req.body), { new: true, runValidators: true });
  if (!coupon) return res.status(404).json({ message: 'Coupon not found.' });
  res.json(coupon);
});

exports.deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) return res.status(404).json({ message: 'Coupon not found.' });
  res.json({ message: 'Coupon deleted.' });
});