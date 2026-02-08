/**
 * Gremlin Demo Shop - E2E Happy Path Test
 *
 * Hand-written Playwright test that proves the full e-commerce flow works:
 * Home -> Products -> View Details -> Add to Cart -> Cart -> Checkout -> Order Confirmation
 *
 * This test exercises the same flow that the GremlinSpec state machine describes,
 * validating that the generated spec accurately models the real application behavior.
 */

import { test, expect } from '@playwright/test';

test.describe('Gremlin Demo Shop - Happy Path', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start with a fresh cart
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('complete purchase flow: browse -> add to cart -> checkout -> order confirmation', async ({ page }) => {
    // =========================================================================
    // Step 1: Home Page
    // =========================================================================
    await page.goto('/');
    await expect(page.getByTestId('hero-browse-btn')).toBeVisible();
    await expect(page.getByTestId('nav-products')).toBeVisible();
    await expect(page.getByTestId('nav-cart')).toBeVisible();

    // =========================================================================
    // Step 2: Navigate to Products
    // =========================================================================
    await page.getByTestId('nav-products').click();
    await page.waitForURL('**/products.html');
    await expect(page.getByTestId('products-grid')).toBeVisible();

    // Wait for products to be rendered dynamically
    await expect(page.getByTestId('product-card-1')).toBeVisible();
    await expect(page.getByTestId('product-card-2')).toBeVisible();

    // =========================================================================
    // Step 3: View Product Details (opens modal)
    // =========================================================================
    await page.getByTestId('product-view-details-1').click();

    // Modal should be visible with product detail content
    const modal = page.getByTestId('product-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('product-detail-add-to-cart-1')).toBeVisible();

    // =========================================================================
    // Step 4: Add to Cart from Modal
    // =========================================================================
    await page.getByTestId('product-detail-add-to-cart-1').click();

    // Modal closes after adding to cart, and cart badge should update
    await expect(modal).toBeHidden();

    // Cart badge should show 1 item
    const cartBadge = page.getByTestId('cart-badge');
    await expect(cartBadge).toHaveText('1');

    // =========================================================================
    // Step 5: Navigate to Cart
    // =========================================================================
    await page.getByTestId('nav-cart').click();
    await page.waitForURL('**/cart.html');

    // Cart should show our item
    await expect(page.getByTestId('cart-items-container')).toBeVisible();
    await expect(page.getByTestId('cart-item-1')).toBeVisible();

    // Cart summary should show non-zero values
    const subtotal = page.getByTestId('cart-subtotal');
    await expect(subtotal).not.toHaveText('$0.00');

    const total = page.getByTestId('cart-total');
    await expect(total).not.toHaveText('$0.00');

    // =========================================================================
    // Step 6: Proceed to Checkout
    // =========================================================================
    await page.getByTestId('cart-checkout-btn').click();
    await page.waitForURL('**/checkout.html');

    // Checkout form should be visible, starting with shipping step
    await expect(page.getByTestId('checkout-form')).toBeVisible();
    await expect(page.getByTestId('step-shipping')).toHaveClass(/active/);

    // =========================================================================
    // Step 7: Fill Shipping Information
    // =========================================================================
    await page.getByTestId('checkout-email').fill('test@gremlin.dev');
    await page.getByTestId('checkout-first-name').fill('Jane');
    await page.getByTestId('checkout-last-name').fill('Doe');
    await page.getByTestId('checkout-address').fill('123 Test Street');
    await page.getByTestId('checkout-city').fill('San Francisco');
    await page.getByTestId('checkout-state').selectOption('CA');
    await page.getByTestId('checkout-zip').fill('94102');
    await page.getByTestId('checkout-phone').fill('5551234567');

    // Continue to payment
    await page.getByTestId('continue-to-payment-btn').click();

    // Payment section should now be visible
    await expect(page.getByTestId('step-payment')).toHaveClass(/active/);

    // =========================================================================
    // Step 8: Fill Payment Information
    // =========================================================================
    await page.getByTestId('checkout-card-number').fill('4111111111111111');
    await page.getByTestId('checkout-expiry').fill('12/28');
    await page.getByTestId('checkout-cvv').fill('123');

    // Continue to review
    await page.getByTestId('continue-to-review-btn').click();

    // Review section should now be visible
    await expect(page.getByTestId('step-review')).toHaveClass(/active/);

    // =========================================================================
    // Step 9: Review and Place Order
    // =========================================================================
    // Order review should show our item
    await expect(page.getByTestId('order-review')).toBeVisible();

    // Agree to terms
    await page.getByTestId('checkout-agree-terms').check();

    // Place the order
    await page.getByTestId('place-order-btn').click();

    // =========================================================================
    // Step 10: Order Confirmation
    // =========================================================================
    // Success message should appear
    await expect(page.getByTestId('order-success-message')).toBeVisible();

    // Order number should be generated (starts with GRM-)
    const orderNumber = page.getByTestId('order-number');
    await expect(orderNumber).toBeVisible();
    await expect(orderNumber).toHaveText(/^GRM-/);

    // Confirmation email should match what we entered
    const confirmationEmail = page.getByTestId('confirmation-email');
    await expect(confirmationEmail).toHaveText('test@gremlin.dev');

    // Back to home link should be present
    await expect(page.getByTestId('success-back-home-btn')).toBeVisible();
  });
});
