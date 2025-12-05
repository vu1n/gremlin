/**
 * Gremlin Demo Shop - App Logic
 * Manages products, cart state, and checkout flow
 */

// ============================================================================
// Product Data
// ============================================================================

const PRODUCTS = [
  {
    id: 1,
    name: 'Wireless Headphones',
    category: 'electronics',
    price: 79.99,
    image: '🎧',
    description: 'Premium wireless headphones with active noise cancellation.',
    features: ['Bluetooth 5.0', '30hr battery', 'Quick charge']
  },
  {
    id: 2,
    name: 'Smart Watch',
    category: 'electronics',
    price: 299.99,
    image: '⌚',
    description: 'Fitness tracking and notifications on your wrist.',
    features: ['Heart rate monitor', 'GPS', 'Water resistant']
  },
  {
    id: 3,
    name: 'Cotton T-Shirt',
    category: 'clothing',
    price: 24.99,
    image: '👕',
    description: 'Comfortable 100% organic cotton t-shirt.',
    features: ['Organic cotton', 'Machine washable', 'Multiple colors']
  },
  {
    id: 4,
    name: 'Denim Jeans',
    category: 'clothing',
    price: 59.99,
    image: '👖',
    description: 'Classic fit denim jeans with stretch.',
    features: ['Stretch denim', 'Multiple sizes', 'Durable']
  },
  {
    id: 5,
    name: 'JavaScript Guide',
    category: 'books',
    price: 39.99,
    image: '📚',
    description: 'Complete guide to modern JavaScript development.',
    features: ['600+ pages', 'Code examples', 'Online resources']
  },
  {
    id: 6,
    name: 'Design Patterns',
    category: 'books',
    price: 49.99,
    image: '📖',
    description: 'Essential software design patterns and best practices.',
    features: ['Classic reference', 'UML diagrams', 'Real examples']
  },
  {
    id: 7,
    name: 'Mechanical Keyboard',
    category: 'electronics',
    price: 149.99,
    image: '⌨️',
    description: 'RGB mechanical keyboard with custom switches.',
    features: ['Cherry MX switches', 'RGB backlight', 'Programmable']
  },
  {
    id: 8,
    name: 'Backpack',
    category: 'clothing',
    price: 69.99,
    image: '🎒',
    description: 'Durable laptop backpack with multiple compartments.',
    features: ['Laptop sleeve', 'Water resistant', 'Ergonomic']
  }
];

// ============================================================================
// Cart State Management
// ============================================================================

class CartManager {
  constructor() {
    this.items = this.loadCart();
    this.listeners = [];
  }

  loadCart() {
    try {
      const saved = localStorage.getItem('gremlin-demo-cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  saveCart() {
    localStorage.setItem('gremlin-demo-cart', JSON.stringify(this.items));
    this.notifyListeners();
  }

  addItem(productId, quantity = 1) {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return;

    const existingItem = this.items.find(item => item.productId === productId);

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      this.items.push({
        productId,
        quantity,
        product
      });
    }

    this.saveCart();
    return true;
  }

  removeItem(productId) {
    this.items = this.items.filter(item => item.productId !== productId);
    this.saveCart();
  }

  updateQuantity(productId, quantity) {
    const item = this.items.find(item => item.productId === productId);
    if (item) {
      item.quantity = Math.max(0, quantity);
      if (item.quantity === 0) {
        this.removeItem(productId);
      } else {
        this.saveCart();
      }
    }
  }

  getItems() {
    return this.items;
  }

  getItemCount() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  getSubtotal() {
    return this.items.reduce((sum, item) => {
      return sum + (item.product.price * item.quantity);
    }, 0);
  }

  getShipping() {
    const subtotal = this.getSubtotal();
    return subtotal > 0 ? (subtotal > 100 ? 0 : 9.99) : 0;
  }

  getTax() {
    return this.getSubtotal() * 0.08; // 8% tax
  }

  getTotal() {
    return this.getSubtotal() + this.getShipping() + this.getTax();
  }

  clear() {
    this.items = [];
    this.saveCart();
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this.items));
  }
}

// Create global cart instance
window.cart = new CartManager();

// ============================================================================
// UI Update Functions
// ============================================================================

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (badge) {
    const count = window.cart.getItemCount();
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

// ============================================================================
// Products Page
// ============================================================================

function initProductsPage() {
  const grid = document.getElementById('products-grid');
  const categoryFilter = document.getElementById('category-filter');
  const sortFilter = document.getElementById('sort-filter');
  const modal = document.getElementById('product-modal');

  if (!grid) return;

  function renderProducts() {
    const category = categoryFilter?.value || 'all';
    const sort = sortFilter?.value || 'name';

    let filtered = category === 'all'
      ? [...PRODUCTS]
      : PRODUCTS.filter(p => p.category === category);

    // Sort products
    filtered.sort((a, b) => {
      if (sort === 'price-asc') return a.price - b.price;
      if (sort === 'price-desc') return b.price - a.price;
      return a.name.localeCompare(b.name);
    });

    grid.innerHTML = filtered.map(product => `
      <div class="product-card" data-testid="product-card-${product.id}">
        <div class="product-image">${product.image}</div>
        <h3 class="product-name">${product.name}</h3>
        <p class="product-category">${product.category}</p>
        <p class="product-price">${formatCurrency(product.price)}</p>
        <div class="product-actions">
          <button
            class="btn btn-primary btn-sm"
            data-testid="product-add-to-cart-${product.id}"
            onclick="window.addToCart(${product.id})"
          >
            Add to Cart
          </button>
          <button
            class="btn btn-outline btn-sm"
            data-testid="product-view-details-${product.id}"
            onclick="window.showProductDetails(${product.id})"
          >
            Details
          </button>
        </div>
      </div>
    `).join('');
  }

  // Initial render
  renderProducts();

  // Filter listeners
  categoryFilter?.addEventListener('change', renderProducts);
  sortFilter?.addEventListener('change', renderProducts);

  // Modal close
  modal?.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('.modal-close')) {
      modal.style.display = 'none';
    }
  });
}

window.addToCart = function(productId) {
  if (window.cart.addItem(productId)) {
    // Show success feedback
    const btn = document.querySelector(`[data-testid="product-add-to-cart-${productId}"]`);
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '✓ Added';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1000);
    }
  }
};

window.showProductDetails = function(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;

  const modal = document.getElementById('product-modal');
  const modalBody = document.getElementById('modal-body');

  modalBody.innerHTML = `
    <div class="product-detail">
      <div class="product-detail-image">${product.image}</div>
      <h2>${product.name}</h2>
      <p class="product-detail-category">${product.category}</p>
      <p class="product-detail-price">${formatCurrency(product.price)}</p>
      <p class="product-detail-description">${product.description}</p>
      <h3>Features:</h3>
      <ul class="product-features">
        ${product.features.map(f => `<li>${f}</li>`).join('')}
      </ul>
      <button
        class="btn btn-primary btn-lg"
        data-testid="product-detail-add-to-cart-${product.id}"
        onclick="window.addToCart(${product.id}); document.getElementById('product-modal').style.display='none';"
      >
        Add to Cart
      </button>
    </div>
  `;

  modal.style.display = 'flex';
};

// ============================================================================
// Cart Page
// ============================================================================

function initCartPage() {
  const container = document.getElementById('cart-items-container');
  const emptyState = document.getElementById('empty-cart');
  const checkoutBtn = document.getElementById('checkout-btn');

  if (!container) return;

  function renderCart() {
    const items = window.cart.getItems();

    if (items.length === 0) {
      container.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    container.style.display = 'block';
    emptyState.style.display = 'none';

    container.innerHTML = items.map(item => `
      <div class="cart-item" data-testid="cart-item-${item.productId}">
        <div class="cart-item-image">${item.product.image}</div>
        <div class="cart-item-details">
          <h3>${item.product.name}</h3>
          <p class="cart-item-price">${formatCurrency(item.product.price)}</p>
        </div>
        <div class="cart-item-quantity">
          <button
            data-testid="cart-decrease-qty-${item.productId}"
            onclick="window.cart.updateQuantity(${item.productId}, ${item.quantity - 1})"
            class="qty-btn"
          >-</button>
          <input
            type="number"
            value="${item.quantity}"
            min="1"
            data-testid="cart-qty-input-${item.productId}"
            onchange="window.cart.updateQuantity(${item.productId}, parseInt(this.value))"
            class="qty-input"
          >
          <button
            data-testid="cart-increase-qty-${item.productId}"
            onclick="window.cart.updateQuantity(${item.productId}, ${item.quantity + 1})"
            class="qty-btn"
          >+</button>
        </div>
        <div class="cart-item-total">
          ${formatCurrency(item.product.price * item.quantity)}
        </div>
        <button
          data-testid="cart-remove-item-${item.productId}"
          onclick="window.cart.removeItem(${item.productId})"
          class="cart-item-remove"
        >×</button>
      </div>
    `).join('');

    updateCartSummary();
  }

  function updateCartSummary() {
    const subtotal = window.cart.getSubtotal();
    const shipping = window.cart.getShipping();
    const tax = window.cart.getTax();
    const total = window.cart.getTotal();

    document.getElementById('subtotal').textContent = formatCurrency(subtotal);
    document.getElementById('shipping').textContent = formatCurrency(shipping);
    document.getElementById('tax').textContent = formatCurrency(tax);
    document.getElementById('total').textContent = formatCurrency(total);
  }

  // Initial render
  renderCart();

  // Listen to cart changes
  window.cart.onChange(renderCart);

  // Checkout button
  checkoutBtn?.addEventListener('click', () => {
    if (window.cart.getItems().length > 0) {
      window.location.href = '/checkout.html';
    }
  });

  // Promo code
  const promoBtn = document.querySelector('[data-testid="promo-apply-btn"]');
  const promoInput = document.getElementById('promo-code');
  const promoMessage = document.getElementById('promo-message');

  promoBtn?.addEventListener('click', () => {
    const code = promoInput.value.trim().toUpperCase();
    if (code === 'GREMLIN10') {
      promoMessage.textContent = '✓ Promo code applied! 10% off';
      promoMessage.className = 'promo-message success';
    } else {
      promoMessage.textContent = '✗ Invalid promo code';
      promoMessage.className = 'promo-message error';
    }
  });
}

// ============================================================================
// Checkout Page
// ============================================================================

function initCheckoutPage() {
  const form = document.getElementById('checkout-form');
  if (!form) return;

  let currentStep = 1;

  // Render order summary
  function renderCheckoutSummary() {
    const items = window.cart.getItems();
    const itemsContainer = document.getElementById('checkout-items');

    itemsContainer.innerHTML = items.map(item => `
      <div class="checkout-item">
        <span>${item.product.image} ${item.product.name} × ${item.quantity}</span>
        <span>${formatCurrency(item.product.price * item.quantity)}</span>
      </div>
    `).join('');

    document.getElementById('checkout-subtotal').textContent = formatCurrency(window.cart.getSubtotal());
    document.getElementById('checkout-shipping').textContent = formatCurrency(window.cart.getShipping());
    document.getElementById('checkout-tax').textContent = formatCurrency(window.cart.getTax());
    document.getElementById('checkout-total').textContent = formatCurrency(window.cart.getTotal());
  }

  renderCheckoutSummary();

  // Step navigation
  function showStep(step) {
    currentStep = step;

    // Hide all sections
    document.getElementById('shipping-section').style.display = 'none';
    document.getElementById('payment-section').style.display = 'none';
    document.getElementById('review-section').style.display = 'none';

    // Show current section
    if (step === 1) document.getElementById('shipping-section').style.display = 'block';
    if (step === 2) document.getElementById('payment-section').style.display = 'block';
    if (step === 3) {
      document.getElementById('review-section').style.display = 'block';
      renderOrderReview();
    }

    // Update step indicators
    document.querySelectorAll('.checkout-steps .step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === step);
      el.classList.toggle('completed', i + 1 < step);
    });
  }

  // Continue to payment
  document.querySelector('[data-testid="continue-to-payment-btn"]')?.addEventListener('click', () => {
    if (validateShipping()) {
      showStep(2);
    }
  });

  // Continue to review
  document.querySelector('[data-testid="continue-to-review-btn"]')?.addEventListener('click', () => {
    if (validatePayment()) {
      showStep(3);
    }
  });

  // Back buttons
  document.querySelector('[data-testid="back-to-shipping-btn"]')?.addEventListener('click', () => showStep(1));
  document.querySelector('[data-testid="back-to-payment-btn"]')?.addEventListener('click', () => showStep(2));

  // Form validation
  function validateShipping() {
    const required = ['email', 'first-name', 'last-name', 'address', 'city', 'state', 'zip'];
    return required.every(id => {
      const input = document.getElementById(id);
      return input && input.value.trim() !== '';
    });
  }

  function validatePayment() {
    const cardNumber = document.getElementById('card-number').value;
    return cardNumber.replace(/\s/g, '').length >= 13;
  }

  // Render order review
  function renderOrderReview() {
    const reviewContainer = document.getElementById('order-review');
    const formData = {
      email: document.getElementById('email').value,
      name: `${document.getElementById('first-name').value} ${document.getElementById('last-name').value}`,
      address: document.getElementById('address').value,
      city: document.getElementById('city').value,
      state: document.getElementById('state').value,
      zip: document.getElementById('zip').value,
      phone: document.getElementById('phone').value,
      card: document.getElementById('card-number').value.slice(-4)
    };

    reviewContainer.innerHTML = `
      <div class="review-section">
        <h3>Shipping Address</h3>
        <p>${formData.name}<br>
        ${formData.address}<br>
        ${formData.city}, ${formData.state} ${formData.zip}<br>
        ${formData.phone}</p>
      </div>
      <div class="review-section">
        <h3>Payment Method</h3>
        <p>Card ending in ${formData.card}</p>
      </div>
      <div class="review-section">
        <h3>Items</h3>
        ${window.cart.getItems().map(item => `
          <p>${item.product.image} ${item.product.name} × ${item.quantity} - ${formatCurrency(item.product.price * item.quantity)}</p>
        `).join('')}
      </div>
    `;
  }

  // Form submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!document.getElementById('agree-terms').checked) {
      alert('Please agree to the terms and conditions');
      return;
    }

    // Simulate order placement
    const orderId = 'GRM-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const email = document.getElementById('email').value;

    document.getElementById('order-number').textContent = orderId;
    document.getElementById('confirmation-email').textContent = email;

    // Hide form, show success
    form.style.display = 'none';
    document.getElementById('success-message').style.display = 'block';

    // Clear cart
    window.cart.clear();
  });
}

// ============================================================================
// Initialize on page load
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Update cart badge on all pages
  updateCartBadge();
  window.cart.onChange(updateCartBadge);

  // Initialize page-specific functionality
  const path = window.location.pathname;

  if (path.includes('products.html')) {
    initProductsPage();
  } else if (path.includes('cart.html')) {
    initCartPage();
  } else if (path.includes('checkout.html')) {
    initCheckoutPage();
  }
});
