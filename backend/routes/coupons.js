const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const { listCoupons, createCoupon, updateCoupon, deleteCoupon } = require('../controllers/couponController');
const { validateCoupon } = require('../controllers/couponController');

router.get('/validate', validateCoupon);
router.use(protect, admin);
router.route('/').get(listCoupons).post(createCoupon);
router.route('/:id').put(updateCoupon).delete(deleteCoupon);

module.exports = router;