const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const { products } = require('../data/seedData');

/**
 * Seed the database only if it is empty. Runs automatically on server boot so
 * that a fresh (or in-memory) database always has products and an admin login.
 */
module.exports = async function autoSeed() {
  const productCount = await Product.countDocuments();
  if (productCount === 0) {
    await Product.insertMany(products);
    console.log(`🌱 Auto-seeded ${products.length} sample products.`);
  } else {
    const existing = await Product.find({}, { name: 1 }).lean();
    const knownNames = new Set(existing.map((product) => product.name));
    const missing = products.filter((product) => !knownNames.has(product.name));
    if (missing.length) {
      await Product.insertMany(missing);
      console.log(`🌱 Added ${missing.length} new catalog products.`);
    }
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@fashionhub.com').toLowerCase();
  const adminExists = await User.findOne({ email: adminEmail });
  if (!adminExists) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (process.env.NODE_ENV === 'production' && (!adminPassword || adminPassword.length < 12)) {
      console.warn('⚠️  Admin account was not created; configure ADMIN_PASSWORD with at least 12 characters.');
    } else {
      await User.create({
        name: process.env.ADMIN_NAME || 'Admin',
        email: adminEmail,
        password: adminPassword || 'admin123',
        role: 'admin',
      });
      console.log(`🌱 Auto-created admin account: ${adminEmail}`);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const demoExists = await User.findOne({ email: 'user@fashionhub.com' });
    if (!demoExists) {
      await User.create({ name: 'Demo User', email: 'user@fashionhub.com', password: 'user123', role: 'user' });
      console.log('🌱 Auto-created demo user for local development.');
    }
  }

  await Coupon.updateOne(
    { code: 'WELCOME10' },
    { $setOnInsert: { code: 'WELCOME10', discountPercent: 10, minOrderValue: 500, expiresAt: new Date('2099-12-31'), active: true } },
    { upsert: true }
  );
};
