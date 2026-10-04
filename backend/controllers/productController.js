const Product = require('../models/Product');
const asyncHandler = require('../middleware/asyncHandler');

// GET /api/products?search=&category=&sort=&page=&limit=
exports.getProducts = asyncHandler(async (req, res) => {
  const { search, category, brand, sort } = req.query;
  const page = Math.min(100000, Math.max(1, parseInt(req.query.page, 10) || 1));
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));

  const filter = {};
  if (category && category !== 'all') filter.category = category;
  if (brand) filter.brand = brand;
  if (req.query.minPrice !== undefined) {
    const value = Number(req.query.minPrice);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'Minimum price must be a non-negative number.' });
    filter.price = { ...filter.price, $gte: value };
  }
  if (req.query.maxPrice !== undefined) {
    const value = Number(req.query.maxPrice);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'Maximum price must be a non-negative number.' });
    filter.price = { ...filter.price, $lte: value };
  }
  if (filter.price?.$gte !== undefined && filter.price?.$lte !== undefined && filter.price.$gte > filter.price.$lte) {
    return res.status(400).json({ message: 'Minimum price cannot exceed maximum price.' });
  }
  if (req.query.minRating !== undefined) {
    const value = Number(req.query.minRating);
    if (!Number.isFinite(value) || value < 0 || value > 5) return res.status(400).json({ message: 'Minimum rating must be between 0 and 5.' });
    filter.rating = { $gte: value };
  }
  if (req.query.inStock === 'true') filter.countInStock = { $gt: 0 };
  if (req.query.featured === 'true') filter.featured = true;
  if (search) {
    if (typeof search !== 'string' || search.length > 100) return res.status(400).json({ message: 'Search text must be 100 characters or fewer.' });
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { description: { $regex: safeSearch, $options: 'i' } },
      { category: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  const sortMap = {
    priceAsc: { price: 1 },
    priceDesc: { price: -1 },
    rating: { rating: -1 },
    popularity: { numReviews: -1, rating: -1 },
    newest: { createdAt: -1 },
  };
  const sortBy = sortMap[sort] || { createdAt: -1 };

  const [items, total] = await Promise.all([
    Product.find(filter).sort(sortBy).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);

  res.json({ items, page, pages: Math.ceil(total / limit) || 1, total });
});

// GET /api/products/categories
exports.getCategories = asyncHandler(async (req, res) => {
  const categories = await Product.distinct('category');
  res.json(categories.sort());
});

// GET /api/products/:id
exports.getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  const related = await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(3);
  res.json({ product, related });
});

// POST /api/products   (admin)
exports.createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json(product);
});

// PUT /api/products/:id   (admin)
exports.updateProduct = asyncHandler(async (req, res) => {
  const editableFields = ['name', 'brand', 'description', 'price', 'mrp', 'discountPercent', 'category', 'image', 'images', 'variants', 'tags', 'countInStock', 'returnWindow', 'warranty', 'deliveryInfo', 'isNew', 'featured'];
  const updates = Object.fromEntries(editableFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
  const product = await Product.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  });
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json(product);
});

// DELETE /api/products/:id   (admin)
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ message: 'Product removed.' });
});
