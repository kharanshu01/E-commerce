const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const asyncHandler = require('../middleware/asyncHandler');
const sendOrderConfirmation = require('../utils/mailer');
const { calculateOrderTotals } = require('../utils/orderPricing');


function getGateway() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

function validateShipping(shipping = {}) {
  const required = ['firstName', 'lastName', 'phone', 'email', 'address1', 'city', 'postcode', 'country'];
  return required.every((field) => typeof shipping[field] === 'string' && shipping[field].trim());
}

async function priceOrder(clientItems, couponCode) {
  if (!Array.isArray(clientItems) || clientItems.length === 0 || clientItems.length > 50) {
    const error = new Error('Your cart is empty or contains too many items.');
    error.statusCode = 400;
    throw error;
  }
  const products = await Product.find({ _id: { $in: clientItems.map((item) => item.product) } });
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const quantities = new Map();
  for (const item of clientItems) {
    const id = String(item.product || '');
    const qty = Number.parseInt(item.qty, 10);
    if (!byId.has(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      const error = new Error('A cart item is invalid or its quantity exceeds the limit.');
      error.statusCode = 400;
      throw error;
    }
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }
  if ([...quantities.values()].some((qty) => qty > 20)) {
    const error = new Error('A product quantity cannot exceed 20.');
    error.statusCode = 400;
    throw error;
  }
  const items = [...quantities].map(([id, qty]) => {
    const product = byId.get(id);
    return { product: product._id, name: product.name, image: product.image, price: product.price, qty };
  });
  if (items.some((item) => byId.get(String(item.product)).countInStock < item.qty)) {
    const error = new Error('One or more products are no longer available in the requested quantity.');
    error.statusCode = 409;
    throw error;
  }
  const itemsPrice = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  let coupon = null;
  let appliedCoupon = '';
  if (couponCode) {
    coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase(), active: true, expiresAt: { $gt: new Date() } });
    if (!coupon) {
      const error = new Error('Coupon is invalid or expired.');
      error.statusCode = 400;
      throw error;
    }
    if (itemsPrice < coupon.minOrderValue) {
      const error = new Error(`This coupon requires a minimum order of ₹${coupon.minOrderValue}.`);
      error.statusCode = 400;
      throw error;
    }
    appliedCoupon = coupon.code;
  }
  return { items, ...calculateOrderTotals(items, coupon), couponCode: appliedCoupon };
}

async function decrementStock(items) {
  const changed = [];
  for (const item of items) {
    const result = await Product.findOneAndUpdate(
      { _id: item.product, countInStock: { $gte: item.qty } },
      { $inc: { countInStock: -item.qty } },
      { new: true }
    );
    if (!result) {
      await Promise.all(changed.map(({ product, qty }) => Product.updateOne({ _id: product }, { $inc: { countInStock: qty } })));
      return false;
    }
    changed.push(item);
  }
  return true;
}

exports.getPaymentConfig = (req, res) => {
  res.json({ razorpayEnabled: Boolean(getGateway()), keyId: process.env.RAZORPAY_KEY_ID || null });
};

exports.createRazorpayOrder = asyncHandler(async (req, res) => {
  const gateway = getGateway();
  if (!gateway) return res.status(503).json({ message: 'Online payments are not configured. Choose cash on delivery.' });
  const { items, shipping, couponCode } = req.body;
  if (!validateShipping(shipping)) return res.status(400).json({ message: 'Please provide complete shipping details.' });

  const totals = await priceOrder(items, couponCode);
  const receipt = `fh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const gatewayOrder = await gateway.orders.create({
    amount: Math.round(totals.totalPrice * 100),
    currency: 'INR',
    receipt,
    notes: { userId: String(req.user._id) },
  });
  const order = await Order.create({
    user: req.user._id,
    ...totals,
    shipping,
    paymentMethod: 'Razorpay',
    paymentStatus: 'Pending',
    status: 'Pending',
    razorpayOrderId: gatewayOrder.id,
  });
  res.status(201).json({ orderId: order._id, razorpayOrderId: gatewayOrder.id, amount: gatewayOrder.amount, currency: gatewayOrder.currency, keyId: process.env.RAZORPAY_KEY_ID });
});

exports.verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const gateway = getGateway();
  if (!gateway) return res.status(503).json({ message: 'Online payments are not configured.' });
  const { orderId, razorpay_order_id: gatewayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
  if (![orderId, gatewayOrderId, paymentId, signature].every((value) => typeof value === 'string' && value)) {
    return res.status(400).json({ message: 'Payment verification details are incomplete.' });
  }
  const order = await Order.findOne({ _id: orderId, user: req.user._id, razorpayOrderId: gatewayOrderId });
  if (!order) return res.status(404).json({ message: 'Payment order not found.' });
  if (order.isPaid && order.transactionId === paymentId) return res.json(order);

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${gatewayOrderId}|${paymentId}`).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(400).json({ message: 'Payment signature could not be verified.' });
  }

  const payment = await gateway.payments.fetch(paymentId);
  if (payment.order_id !== gatewayOrderId || payment.status !== 'captured' || payment.amount !== Math.round(order.totalPrice * 100) || payment.currency !== 'INR') {
    return res.status(400).json({ message: 'Payment is not captured for the expected amount.' });
  }

  const claimedOrder = await Order.findOneAndUpdate(
    { _id: order._id, isPaid: false, paymentVerificationInProgress: false },
    { $set: { paymentVerificationInProgress: true } },
    { new: true }
  );
  if (!claimedOrder) {
    const latest = await Order.findById(order._id);
    if (latest?.isPaid && latest.transactionId === paymentId) return res.json(latest);
    return res.status(409).json({ message: 'Payment verification is already in progress.' });
  }

  if (!(await decrementStock(claimedOrder.items))) {
    try {
      const refund = await gateway.payments.refund(paymentId, { amount: payment.amount, notes: { reason: 'Inventory unavailable' } });
      claimedOrder.paymentStatus = 'Refunded';
      claimedOrder.status = 'Refunded';
      claimedOrder.refundId = refund.id;
    } catch (refundError) {
      claimedOrder.paymentStatus = 'Paid';
      claimedOrder.isPaid = true;
      claimedOrder.status = 'Processing';
      claimedOrder.transactionId = paymentId;
      claimedOrder.paymentVerificationInProgress = false;
      await claimedOrder.save();
      console.error('Could not automatically refund payment after stock conflict:', refundError.message);
      return res.status(502).json({ message: 'Payment succeeded but inventory changed. Contact support to complete your refund.' });
    }
    claimedOrder.transactionId = paymentId;
    claimedOrder.paymentVerificationInProgress = false;
    await claimedOrder.save();
    return res.status(409).json({ message: 'Stock changed during checkout; the captured payment has been refunded.' });
  }

  claimedOrder.isPaid = true;
  claimedOrder.paymentStatus = 'Paid';
  claimedOrder.paidAt = new Date();
  claimedOrder.transactionId = paymentId;
  claimedOrder.status = 'Processing';
  claimedOrder.paymentVerificationInProgress = false;
  try {
    await claimedOrder.save();
  } catch (error) {
    await Promise.all(claimedOrder.items.map((item) => Product.updateOne({ _id: item.product }, { $inc: { countInStock: item.qty } })));
    await Order.updateOne({ _id: claimedOrder._id }, { $set: { paymentVerificationInProgress: false } });
    throw error;
  }
  req.user.cart = [];
  await req.user.save();
  await sendOrderConfirmation(claimedOrder);
  res.json(claimedOrder);
});

exports.refundPayment = asyncHandler(async (req, res) => {
  const gateway = getGateway();
  if (!gateway) return res.status(503).json({ message: 'Razorpay is not configured.' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!order.isPaid || order.paymentMethod !== 'Razorpay' || !order.transactionId) {
    return res.status(409).json({ message: 'Only completed Razorpay payments can be refunded here.' });
  }
  if (order.paymentStatus === 'Refunded') return res.json(order);
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, isPaid: true, paymentStatus: { $ne: 'Refunded' }, refundInProgress: false },
    { $set: { refundInProgress: true } },
    { new: true }
  );
  if (!claimed) return res.status(409).json({ message: 'A refund is already being processed.' });
  try {
    const refund = await gateway.payments.refund(claimed.transactionId, { amount: Math.round(claimed.totalPrice * 100) });
    claimed.paymentStatus = 'Refunded';
    claimed.status = 'Refunded';
    claimed.refundId = refund.id;
    claimed.refundInProgress = false;
    await claimed.save();
    await sendOrderConfirmation(claimed, true);
    res.json(claimed);
  } catch (error) {
    await Order.updateOne({ _id: claimed._id }, { $set: { refundInProgress: false } });
    throw error;
  }
});

exports.markRazorpayPaymentFailed = asyncHandler(async (req, res) => {
  const { orderId, razorpay_order_id: gatewayOrderId } = req.body;
  const order = await Order.findOne({ _id: orderId, user: req.user._id, razorpayOrderId: gatewayOrderId, isPaid: false });
  if (!order) return res.status(404).json({ message: 'Pending payment order not found.' });
  if (order.paymentVerificationInProgress) return res.status(409).json({ message: 'Payment verification is in progress.' });
  order.paymentStatus = 'Failed';
  await order.save();
  res.json({ message: 'Payment marked as failed.' });
});