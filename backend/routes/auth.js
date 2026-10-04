const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');
const {
  register,
  login,
  googleConfig,
  googleLogin,
  logout,
  me,
  getCart,
  saveCart,
  getWishlist,
  toggleWishlist,
  getAddresses,
  saveAddress,
  getUsers,
} = require('../controllers/authController');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/google/config', googleConfig);
router.post('/google', authLimiter, googleLogin);
router.post('/logout', logout);
router.get('/me', protect, me);
router.get('/cart', protect, getCart);
router.put('/cart', protect, saveCart);
router.get('/wishlist', protect, getWishlist);
router.put('/wishlist/:productId', protect, toggleWishlist);
router.get('/addresses', protect, getAddresses);
router.post('/addresses', protect, saveAddress);
router.get('/users', protect, admin, getUsers);

module.exports = router;
