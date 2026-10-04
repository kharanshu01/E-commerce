// Checkout page: requires auth, submits order to the backend.
(function () {
  const user = window.Auth.requireAuth(); // redirects if not logged in
  if (!user) return;

  const items = window.Cart.read();
  const form = document.getElementById('checkout-form');
  const summaryEl = document.getElementById('checkout-summary');
  const TAX_RATE = 0.05, FREE_SHIP = 500, SHIP_FLAT = 40;

  if (!items.length) {
    document.querySelector('main .container').innerHTML =
      '<div class="empty-state"><i class="fas fa-shopping-cart"></i><h4>Your cart is empty</h4><a href="product.html" class="btn btn-primary mt-2">Shop Now</a></div>';
    return;
  }

  // Prefill email/name and offer saved addresses.
  form.email.value = user.email || '';
  const [fn, ...rest] = (user.name || '').split(' ');
  form.firstName.value = fn || '';
  form.lastName.value = rest.join(' ');

  const addressFields = ['firstName', 'lastName', 'phone', 'address1', 'address2', 'city', 'postcode', 'country'];
  const addressSelect = document.getElementById('saved-address');
  let savedAddresses = [];
  window.API.get('/auth/addresses', true).then((addresses) => {
    savedAddresses = addresses;
    addresses.forEach((address, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${address.label || 'Address'}: ${address.address1}, ${address.city}`;
      addressSelect.appendChild(option);
    });
    const defaultIndex = addresses.findIndex((address) => address.isDefault);
    if (defaultIndex >= 0) {
      addressSelect.value = String(defaultIndex);
      addressSelect.dispatchEvent(new Event('change'));
    }
  }).catch(() => {});
  addressSelect.addEventListener('change', () => {
    const address = savedAddresses[Number(addressSelect.value)];
    if (!address) return;
    addressFields.forEach((field) => { if (address[field] !== undefined) form.elements[field].value = address[field]; });
  });

  const paymentHelp = document.getElementById('payment-help');
  window.API.get('/orders/payment-config').then((config) => {
    if (!config.razorpayEnabled) {
      document.getElementById('pay-razorpay').disabled = true;
      paymentHelp.textContent = 'Online payments are not configured yet. Cash on Delivery is available.';
    }
  }).catch(() => { document.getElementById('pay-razorpay').disabled = true; });

  const subtotal = window.Cart.subtotal();
  const tax = Math.round(subtotal * TAX_RATE);
  const shipping = subtotal >= FREE_SHIP ? 0 : SHIP_FLAT;
  const total = subtotal + tax + shipping;

  summaryEl.innerHTML = `
    <h5 class="mb-4">Order Summary</h5>
    ${items.map((i) => `<div class="d-flex justify-content-between mb-2"><span class="text-truncate mr-2">${i.name} <small class="text-muted">×${i.qty}</small></span><span>${window.fmt(i.price * i.qty)}</span></div>`).join('')}
    <hr>
    <div class="d-flex justify-content-between mb-2"><span>Subtotal</span><span>${window.fmt(subtotal)}</span></div>
    <div class="d-flex justify-content-between mb-2"><span>Tax</span><span>${window.fmt(tax)}</span></div>
    <div class="d-flex justify-content-between mb-2"><span>Shipping</span><span>${shipping === 0 ? '<span class="text-success">FREE</span>' : window.fmt(shipping)}</span></div>
    <div class="form-group mt-3 mb-3"><label class="small font-weight-bold" for="coupon-code">Coupon code</label><input id="coupon-code" class="form-control" placeholder="Try WELCOME10"></div>
    <div class="d-flex justify-content-between mb-2" id="coupon-discount-row" style="display:none!important"><span>Discount</span><span class="text-success" id="coupon-discount-value"></span></div>
    <button type="button" class="btn btn-outline-primary btn-sm mb-3" id="apply-coupon">Apply coupon</button>
    <div class="small mb-2" id="coupon-message" aria-live="polite"></div>
    <hr>
    <div class="d-flex justify-content-between mb-4"><strong>Total</strong><strong class="text-gradient" id="checkout-total" style="font-size:1.3rem">${window.fmt(total)}</strong></div>
    <button type="submit" form="checkout-form" class="btn btn-primary btn-block btn-lg" id="place-order">
      <i class="fas fa-lock mr-2"></i>Place Order
    </button>`;

  document.getElementById('apply-coupon').addEventListener('click', async () => {
    const message = document.getElementById('coupon-message');
    const code = document.getElementById('coupon-code').value.trim();
    if (!code) { message.textContent = 'Enter a coupon code first.'; message.className = 'small mb-2 text-danger'; return; }
    try {
      const result = await window.API.post('/coupons/validate', { code, items: items.map((item) => ({ product: item.id, qty: item.qty })) });
      document.getElementById('coupon-discount-row').style.setProperty('display', 'flex', 'important');
      document.getElementById('coupon-discount-value').textContent = `−${window.fmt(result.discountPrice)}`;
      document.getElementById('checkout-total').textContent = window.fmt(result.totalPrice);
      message.textContent = `${result.code} applied successfully.`;
      message.className = 'small mb-2 text-success';
    } catch (err) {
      document.getElementById('coupon-discount-row').style.setProperty('display', 'none', 'important');
      document.getElementById('checkout-total').textContent = window.fmt(total);
      message.textContent = err.message;
      message.className = 'small mb-2 text-danger';
    }
  });
  document.getElementById('coupon-code').addEventListener('input', () => {
    document.getElementById('coupon-discount-row').style.setProperty('display', 'none', 'important');
    document.getElementById('checkout-total').textContent = window.fmt(total);
    const message = document.getElementById('coupon-message');
    message.textContent = '';
    message.className = 'small mb-2';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const btn = document.getElementById('place-order');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-2"></span>Processing...';

    const formData = Object.fromEntries(new FormData(form).entries());
    const paymentMethod = formData.paymentMethod;
    delete formData.paymentMethod;
    const shippingData = formData;
    const payload = {
      items: items.map((i) => ({ product: i.id, qty: i.qty })),
      shipping: shippingData,
      couponCode: document.getElementById('coupon-code').value.trim(),
    };

    try {
      if (document.getElementById('save-address').checked) {
        const address = Object.fromEntries(addressFields.map((field) => [field, shippingData[field]]));
        address.label = 'Home';
        await window.API.post('/auth/addresses', address, true);
      }
      if (paymentMethod === 'razorpay') {
        if (!window.Razorpay) throw new Error('Secure checkout could not load. Refresh and try again.');
        const checkout = await window.API.post('/orders/razorpay/order', payload, true);
        const gateway = new window.Razorpay({
          key: checkout.keyId,
          amount: checkout.amount,
          currency: checkout.currency,
          name: 'FashionHub',
          description: 'FashionHub order payment',
          order_id: checkout.razorpayOrderId,
          prefill: { name: `${shippingData.firstName} ${shippingData.lastName}`, email: shippingData.email, contact: shippingData.phone },
          theme: { color: '#6d28d9' },
          handler: async (response) => {
            try {
              await window.API.post('/orders/razorpay/verify', { orderId: checkout.orderId, ...response }, true);
              window.Cart.clear();
              location.href = `order_confirmation.html?id=${checkout.orderId}`;
            } catch (err) {
              btn.disabled = false;
              btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Place Order';
              window.toast(err.message, 'error');
            }
          },
          modal: { ondismiss: () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Place Order'; } },
        });
        gateway.on('payment.failed', async (event) => {
          try {
            await window.API.post('/orders/razorpay/failed', { orderId: checkout.orderId, razorpay_order_id: checkout.razorpayOrderId }, true);
          } catch {}
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Place Order';
          window.toast(event.error.description || 'Payment failed. You can retry checkout.', 'error');
        });
        gateway.open();
        return;
      }
      const order = await window.API.post('/orders', { ...payload, paymentMethod: 'Cash on Delivery' }, true);
      window.Cart.clear();
      location.href = `order_confirmation.html?id=${order._id}`;
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Place Order';
      window.toast(err.message, 'error');
      if (err.status === 401) setTimeout(() => (location.href = 'login.html?next=checkout.html'), 1000);
    }
  });
})();
