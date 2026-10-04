const TAX_RATE = 0.05;
const FREE_SHIP_THRESHOLD = 500;
const SHIP_FLAT = 40;

function calculateOrderTotals(items, coupon = null) {
  const itemsPrice = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountPrice = coupon ? Math.round(itemsPrice * coupon.discountPercent) / 100 : 0;
  const taxPrice = Math.round(itemsPrice * TAX_RATE * 100) / 100;
  const shippingPrice = itemsPrice >= FREE_SHIP_THRESHOLD ? 0 : SHIP_FLAT;
  const totalPrice = Math.round((itemsPrice - discountPrice + taxPrice + shippingPrice) * 100) / 100;
  return { itemsPrice, discountPrice, taxPrice, shippingPrice, totalPrice };
}

module.exports = { calculateOrderTotals };