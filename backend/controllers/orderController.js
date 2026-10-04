const Order = require('../models/Order');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const asyncHandler = require('../middleware/asyncHandler');
const sendOrderConfirmation = require('../utils/mailer');
const { calculateOrderTotals } = require('../utils/orderPricing');

/**
 * Recompute totals on the server from real product prices so the client
 * cannot tamper with the amount charged.
 */
async function buildOrderItems(clientItems) {
  if (!Array.isArray(clientItems) || clientItems.length === 0 || clientItems.length > 50) return [];
  const ids = clientItems.map((i) => i.product);
  const products = await Product.find({ _id: { $in: ids } });
  const map = new Map(products.map((p) => [String(p._id), p]));
  const quantities = new Map();
  for (const ci of clientItems) {
    const id = String(ci.product || '');
    const qty = Number.parseInt(ci.qty, 10);
    if (!map.has(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) return [];
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }
  if ([...quantities.values()].some((qty) => qty > 20)) return [];
  return [...quantities].map(([id, qty]) => {
    const product = map.get(id);
    return { product: product._id, name: product.name, image: product.image, price: product.price, qty };
  });
}

async function decreaseStock(items) {
  const changed = [];
  for (const item of items) {
    const product = await Product.findOneAndUpdate(
      { _id: item.product, countInStock: { $gte: item.qty } },
      { $inc: { countInStock: -item.qty } },
      { new: true }
    );
    if (!product) {
      await Promise.all(changed.map(({ product: productId, qty }) => Product.updateOne({ _id: productId }, { $inc: { countInStock: qty } })));
      return false;
    }
    changed.push(item);
  }
  return true;
}

// POST /api/orders   (protected) — create order (simulated payment)
exports.createOrder = asyncHandler(async (req, res) => {
  const { items: clientItems, shipping, paymentMethod = 'Cash on Delivery', couponCode } = req.body;
  if (paymentMethod !== 'Cash on Delivery') {
    return res.status(400).json({ message: 'Online payment must be completed through the configured payment gateway.' });
  }
  const requiredShippingFields = ['firstName', 'lastName', 'phone', 'email', 'address1', 'city', 'postcode', 'country'];
  if (!shipping || !requiredShippingFields.every((field) => typeof shipping[field] === 'string' && shipping[field].trim())) {
    return res.status(400).json({ message: 'Please provide complete shipping details.' });
  }
  if (!Array.isArray(clientItems) || clientItems.length === 0) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }

  const items = await buildOrderItems(clientItems);
  if (items.length === 0) return res.status(400).json({ message: 'No valid products in cart.' });

  let coupon = null;
  let appliedCoupon = '';
  if (couponCode) {
    coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), active: true, expiresAt: { $gt: new Date() } });
    if (!coupon) return res.status(400).json({ message: 'Coupon is invalid or expired.' });
    if (items.reduce((sum, item) => sum + item.price * item.qty, 0) < coupon.minOrderValue) return res.status(400).json({ message: `This coupon requires a minimum order of ₹${coupon.minOrderValue}.` });
    appliedCoupon = coupon.code;
  }
  const totals = calculateOrderTotals(items, coupon);

  if (!(await decreaseStock(items))) {
    return res.status(409).json({ message: 'One or more products are no longer available in the requested quantity.' });
  }

  let order;
  try {
    order = await Order.create({
    user: req.user._id,
    items,
    shipping: shipping || {},
    ...totals,
    couponCode: appliedCoupon,
    paymentMethod,
    isPaid: false,
    paymentStatus: 'Pending',
    transactionId: '',
    status: 'Pending',
    });
  } catch (error) {
    await Promise.all(items.map((item) => Product.updateOne({ _id: item.product }, { $inc: { countInStock: item.qty } })));
    throw error;
  }

  // Clear the user's server-side cart after a successful order.
  req.user.cart = [];
  await req.user.save();
  await sendOrderConfirmation(order);

  res.status(201).json(order);
});

// GET /api/orders/mine   (protected)
exports.getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(orders);
});

// GET /api/orders/:id   (protected — owner or admin)
exports.getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email');
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const isOwner = String(order.user._id) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not authorized to view this order.' });
  }
  res.json(order);
});

// GET /api/orders   (admin) — all orders
exports.getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 });
  res.json(orders);
});

// PUT /api/orders/:id/status   (admin)
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, trackingNumber, courier } = req.body;
  const allowedStatuses = ['Pending', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded'];
  if (status !== undefined && !allowedStatuses.includes(status)) return res.status(400).json({ message: 'Order status is invalid.' });
  const existingOrder = await Order.findById(req.params.id);
  if (!existingOrder) return res.status(404).json({ message: 'Order not found.' });
  const previousStatus = existingOrder.status;
  if (status === 'Refunded' && previousStatus !== 'Refunded') return res.status(400).json({ message: 'Use the payment refund action to refund a paid order.' });
  if (status === 'Cancelled' && existingOrder.isPaid && existingOrder.paymentStatus !== 'Refunded') {
    return res.status(409).json({ message: 'Refund the captured payment before cancelling this order.' });
  }
  const changes = {};
  if (status !== undefined) changes.status = status;
  if (trackingNumber !== undefined) changes.trackingNumber = trackingNumber;
  if (courier !== undefined) changes.courier = courier;
  if ((status || previousStatus) === 'Delivered' && !existingOrder.deliveredAt) changes.deliveredAt = new Date();
  const order = await Order.findOneAndUpdate(
    { _id: existingOrder._id, status: previousStatus },
    { $set: changes },
    { new: true, runValidators: true }
  );
  if (!order) return res.status(409).json({ message: 'Order changed while you were updating it. Refresh and try again.' });
  if (previousStatus !== 'Cancelled' && order.status === 'Cancelled') {
    await Product.bulkWrite(order.items.map((item) => ({
      updateOne: { filter: { _id: item.product }, update: { $inc: { countInStock: item.qty } } },
    })));
  }
  if (order.status !== previousStatus) await sendOrderConfirmation(order, true);
  res.json(order);
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, isPaid: false, status: { $in: ['Pending', 'Processing'] } },
    { $set: { status: 'Cancelled' } },
    { new: true }
  );
  if (!order) {
    const existing = await Order.exists({ _id: req.params.id, user: req.user._id });
    if (!existing) return res.status(404).json({ message: 'Order not found.' });
    return res.status(409).json({ message: 'This order can no longer be cancelled.' });
  }
  await Product.bulkWrite(order.items.map((item) => ({
    updateOne: { filter: { _id: item.product }, update: { $inc: { countInStock: item.qty } } },
  })));
  await sendOrderConfirmation(order, true);
  res.json(order);
});
