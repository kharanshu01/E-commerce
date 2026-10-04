const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrderTotals } = require('../utils/orderPricing');

test('charges flat shipping below the free-shipping threshold', () => {
  assert.deepEqual(calculateOrderTotals([{ price: 100, qty: 2 }]), {
    itemsPrice: 200,
    discountPrice: 0,
    taxPrice: 10,
    shippingPrice: 40,
    totalPrice: 250,
  });
});

test('waives shipping at the threshold and includes coupon discount in total', () => {
  assert.deepEqual(calculateOrderTotals([{ price: 500, qty: 1 }], { discountPercent: 10 }), {
    itemsPrice: 500,
    discountPrice: 50,
    taxPrice: 25,
    shippingPrice: 0,
    totalPrice: 475,
  });
});

test('rounds discount, tax, and payable amount to two decimal places', () => {
  assert.deepEqual(calculateOrderTotals([{ price: 199.99, qty: 3 }], { discountPercent: 15 }), {
    itemsPrice: 599.97,
    discountPrice: 90,
    taxPrice: 30,
    shippingPrice: 0,
    totalPrice: 539.97,
  });
});