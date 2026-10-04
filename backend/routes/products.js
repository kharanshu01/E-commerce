const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const {
  getProducts,
  getCategories,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { bulkUpdateStock } = require('../controllers/couponController');

router.get('/', getProducts);
router.get('/categories', getCategories);
router.get('/:id', getProduct);

// Admin-only
router.put('/bulk-stock', protect, admin, bulkUpdateStock);
router.post('/', protect, admin, createProduct);
router.put('/:id', protect, admin, updateProduct);
router.delete('/:id', protect, admin, deleteProduct);

module.exports = router;
