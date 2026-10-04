// Admin dashboard: customer, order, and inventory overview.
(function () {
  const user = window.Auth.currentUser();
  if (!user) {
    location.href = 'login.html?next=admin.html';
    return;
  }
  if (user.role !== 'admin') {
    window.Auth.clearSession();
    location.href = 'login.html?next=admin.html';
    return;
  }

  const stats = document.getElementById('admin-stats');
  const ordersEl = document.getElementById('admin-orders');
  const usersEl = document.getElementById('admin-users');
  const productsEl = document.getElementById('admin-products');
  const errorEl = document.getElementById('admin-error');
  const couponsEl = document.getElementById('admin-coupons');
  const statuses = ['Pending', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded'];

  const date = (value) => new Date(value).toLocaleDateString();
  const statusLabel = (value) => value === 'OutForDelivery' ? 'Out for delivery' : value;

  function renderStats(users, orders, products) {
    const revenue = orders.filter((order) => order.isPaid).reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
    const lowStock = products.filter((product) => Number(product.countInStock) < 10).length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekRevenue = orders.filter((order) => order.isPaid && new Date(order.createdAt).getTime() >= weekAgo).reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
    stats.innerHTML = [
      ['fa-users', users.length, 'Customers'],
      ['fa-shopping-bag', orders.length, 'Orders'],
      ['fa-rupee-sign', window.fmt(revenue), 'Paid revenue'],
      ['fa-chart-line', window.fmt(weekRevenue), 'Revenue · 7 days'],
      ['fa-clock', orders.filter((order) => ['Pending', 'Processing'].includes(order.status)).length, 'To fulfill'],
      ['fa-exclamation-triangle', lowStock, 'Low-stock products'],
    ].map(([icon, value, label]) => `<div class="col-md-2 col-6 mb-3"><div class="stat-card h-100"><div class="feature-icon"><i class="fas ${icon}"></i></div><h3>${value}</h3><p>${label}</p></div></div>`).join('');
  }

  function renderOrders(orders) {
    ordersEl.innerHTML = orders.length ? orders.map((order) => `<tr><td>#${String(order._id).slice(-8).toUpperCase()}</td><td>${order.user?.name || 'Unknown'}<br><small class="text-muted">${order.user?.email || ''}</small></td><td>${date(order.createdAt)}</td><td>${window.fmt(order.totalPrice)}<br><small>${order.paymentStatus}</small></td><td><select class="form-control form-control-sm status-change" data-id="${order._id}">${statuses.map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''} ${status === 'Refunded' ? 'disabled' : ''}>${statusLabel(status)}</option>`).join('')}</select></td><td><input class="form-control form-control-sm courier-change" data-id="${order._id}" value="${order.courier || ''}" placeholder="Courier"></td><td><input class="form-control form-control-sm tracking-change" data-id="${order._id}" value="${order.trackingNumber || ''}" placeholder="Tracking #"></td><td><button class="btn btn-sm btn-outline-primary save-order" data-id="${order._id}">Save</button>${order.isPaid && order.paymentStatus !== 'Refunded' ? `<button class="btn btn-sm btn-outline-danger refund-order mt-1" data-id="${order._id}">Refund</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="8" class="text-center text-muted">No orders yet.</td></tr>';
    ordersEl.querySelectorAll('.save-order').forEach((button) => button.addEventListener('click', async () => {
      try {
        const id = button.dataset.id;
        const status = ordersEl.querySelector(`.status-change[data-id="${id}"]`).value;
        const courier = ordersEl.querySelector(`.courier-change[data-id="${id}"]`).value.trim();
        const trackingNumber = ordersEl.querySelector(`.tracking-change[data-id="${id}"]`).value.trim();
        await window.API.put(`/orders/${id}/status`, { status, courier, trackingNumber }, true);
        window.toast('Order fulfillment details saved.', 'success');
      } catch (err) { window.toast(err.message, 'error'); }
    }));
    ordersEl.querySelectorAll('.refund-order').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Issue a full refund through Razorpay?')) return;
      button.disabled = true;
      try {
        await window.API.post(`/orders/${button.dataset.id}/refund`, {}, true);
        window.toast('Refund issued.', 'success');
        load();
      } catch (err) { button.disabled = false; window.toast(err.message, 'error'); }
    }));
  }

  function renderUsers(users) {
    usersEl.innerHTML = users.length ? users.map((item) => `<tr><td>${item.name}</td><td>${item.email}</td><td>${item.role}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted">No customers yet.</td></tr>';
  }

  function renderProducts(products) {
    productsEl.innerHTML = products.length ? products.map((item) => `<tr><td><input class="stock-select" type="checkbox" data-id="${item._id}" aria-label="Select ${item.name}"></td><td>${item.name}</td><td><input class="form-control form-control-sm stock-value" type="number" min="0" value="${item.countInStock}" data-id="${item._id}"></td><td><button class="btn btn-sm btn-outline-primary save-stock" data-id="${item._id}">Save</button></td><td>${window.fmt(item.price)}</td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted">No products found.</td></tr>';
    productsEl.querySelectorAll('.save-stock').forEach((button) => button.addEventListener('click', async () => {
      const input = productsEl.querySelector(`.stock-value[data-id="${button.dataset.id}"]`);
      button.disabled = true;
      try {
        await window.API.put(`/products/${button.dataset.id}`, { countInStock: Number(input.value) }, true);
        window.toast('Inventory updated.', 'success');
      } catch (err) { window.toast(err.message, 'error'); }
      finally { button.disabled = false; }
    }));
  }

  function renderCoupons(coupons) {
    couponsEl.innerHTML = coupons.length ? coupons.map((coupon) => `<tr><td><strong>${coupon.code}</strong></td><td>${coupon.discountPercent}%</td><td>${window.fmt(coupon.minOrderValue)}</td><td>${date(coupon.expiresAt)}</td><td>${coupon.active ? 'Active' : 'Inactive'}</td><td><button class="btn btn-sm btn-outline-secondary toggle-coupon" data-id="${coupon._id}" data-active="${coupon.active}">${coupon.active ? 'Disable' : 'Enable'}</button> <button class="btn btn-sm btn-outline-danger delete-coupon" data-id="${coupon._id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted">No coupons created.</td></tr>';
    couponsEl.querySelectorAll('.toggle-coupon').forEach((button) => button.addEventListener('click', async () => {
      try { await window.API.put(`/coupons/${button.dataset.id}`, { active: button.dataset.active !== 'true' }, true); load(); }
      catch (err) { window.toast(err.message, 'error'); }
    }));
    couponsEl.querySelectorAll('.delete-coupon').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Delete this coupon?')) return;
      try { await window.API.del(`/coupons/${button.dataset.id}`, true); load(); }
      catch (err) { window.toast(err.message, 'error'); }
    }));
  }

  async function load() {
    errorEl.innerHTML = '';
    try {
      const [users, orderData, productData, coupons] = await Promise.all([
        window.API.get('/auth/users', true),
        window.API.get('/orders', true),
        window.API.get('/products?limit=60'),
        window.API.get('/coupons', true),
      ]);
      renderStats(users, orderData, productData.items || []);
      renderOrders(orderData);
      renderUsers(users);
      renderProducts(productData.items || []);
      renderCoupons(coupons);
    } catch (err) {
      errorEl.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  }

  document.getElementById('refresh-admin').addEventListener('click', load);
  document.getElementById('select-all-stock').addEventListener('change', (event) => {
    productsEl.querySelectorAll('.stock-select').forEach((checkbox) => { checkbox.checked = event.target.checked; });
  });
  document.getElementById('bulk-stock-save').addEventListener('click', async (event) => {
    const updates = [...productsEl.querySelectorAll('.stock-select:checked')].map((checkbox) => ({
      id: checkbox.dataset.id,
      countInStock: Number(productsEl.querySelector(`.stock-value[data-id="${checkbox.dataset.id}"]`).value),
    }));
    if (!updates.length) return window.toast('Select products to update.', 'info');
    event.currentTarget.disabled = true;
    try {
      const result = await window.API.put('/products/bulk-stock', { updates }, true);
      window.toast(result.message, 'success');
      load();
    } catch (err) { window.toast(err.message, 'error'); }
    finally { event.currentTarget.disabled = false; }
  });
  document.getElementById('coupon-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    const discountPercent = Number(document.getElementById('coupon-discount').value);
    const minOrderValue = Number(document.getElementById('coupon-minimum').value);
    const expiresAt = new Date(document.getElementById('coupon-expiry').value).toISOString();
    try {
      await window.API.post('/coupons', { code, discountPercent, minOrderValue, expiresAt, active: true }, true);
      event.currentTarget.reset();
      window.toast('Coupon created.', 'success');
      load();
    } catch (err) { window.toast(err.message, 'error'); }
  });
  load();
})();
