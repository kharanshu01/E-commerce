const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const {
  createOrder,
  getMyOrders,
  getOrder,
  getAllOrders,
  updateStatus,
  cancelOrder,
} = require('../controllers/orderController');
const { getPaymentConfig, createRazorpayOrder, verifyRazorpayPayment, markRazorpayPaymentFailed, refundPayment } = require('../controllers/paymentController');

router.get('/payment-config', getPaymentConfig);
router.post('/razorpay/order', protect, createRazorpayOrder);
router.post('/razorpay/verify', protect, verifyRazorpayPayment);
router.post('/razorpay/failed', protect, markRazorpayPaymentFailed);
router.post('/:id/refund', protect, admin, refundPayment);
router.post('/', protect, createOrder);
router.get('/mine', protect, getMyOrders);
router.get('/', protect, admin, getAllOrders);
router.get('/:id', protect, getOrder);
router.put('/:id/status', protect, admin, updateStatus);
router.put('/:id/cancel', protect, cancelOrder);

module.exports = router;
