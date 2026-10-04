// Wishlist page: load saved products and support removing them.
(async function () {
  const grid = document.getElementById('wishlist-grid');
  if (!window.Auth.requireAuth()) return;

  try {
    const products = await window.API.get('/auth/wishlist', true);
    if (!products.length) {
      grid.innerHTML = '<div class="col-12"><div class="empty-state"><i class="far fa-heart"></i><h4>Your wishlist is empty</h4><p>Save products you would like to revisit.</p><a href="product.html" class="btn btn-primary">Explore products</a></div></div>';
      return;
    }
    window.Render.renderProducts(grid, products);
    grid.querySelectorAll('.amazon-style-card').forEach((card, index) => {
      const product = products[index];
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-outline-danger btn-sm mt-2';
      remove.innerHTML = '<i class="fas fa-heart-broken mr-1"></i>Remove from wishlist';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await window.API.put(`/auth/wishlist/${product._id}`, {}, true);
          card.closest('.col-lg-3, .col-md-4, .col-sm-6, .col-12')?.remove();
          window.toast('Removed from wishlist.', 'success');
          if (!grid.querySelector('.amazon-style-card')) {
            grid.innerHTML = '<div class="col-12"><div class="empty-state"><i class="far fa-heart"></i><h4>Your wishlist is empty</h4><a href="product.html" class="btn btn-primary">Explore products</a></div></div>';
          }
        } catch (err) {
          remove.disabled = false;
          window.toast(err.message, 'error');
        }
      });
      card.querySelector('.product-caption')?.appendChild(remove);
    });
  } catch (err) {
    grid.innerHTML = `<div class="col-12"><div class="empty-state"><h4>${err.message}</h4></div></div>`;
  }
})();