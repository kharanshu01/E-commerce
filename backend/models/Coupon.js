const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: [/^[A-Z0-9_-]{2,30}$/, 'Coupon codes may contain only letters, numbers, underscores and hyphens'] },
    discountPercent: { type: Number, required: true, min: 1, max: 100 },
    minOrderValue: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);