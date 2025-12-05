# Gremlin Demo Shop - Web Example App

A fully functional e-commerce demo application showcasing the **@gremlin/recorder-web** SDK for session recording and test generation.

## Overview

This demo app demonstrates how Gremlin captures user interactions with `data-testid` attributes across a multi-page web application. The recorder SDK captures clicks, inputs, navigation, scrolls, and errors, enriching each event with element metadata for automated test generation.

## Features

- **Multi-page Navigation**: Home, Products, Cart, and Checkout pages
- **Shopping Cart**: Add/remove items, update quantities, localStorage persistence
- **Checkout Flow**: Multi-step form with validation
- **Session Recording**: Start/stop recording with live event count
- **Export Sessions**: Download captured sessions as JSON
- **Element Tracking**: All interactive elements have unique `data-testid` attributes
- **Debug Tools**: Console utilities for analyzing recorded sessions

## Tech Stack

- **Vanilla JavaScript** - No framework dependencies
- **Vite** - Lightning-fast dev server and build tool
- **@gremlin/recorder-web** - Session recording SDK
- **CSS3** - Modern, responsive styling with CSS Grid/Flexbox

## Getting Started

### Prerequisites

- **Bun** - Package manager (alternatively use npm/yarn)
- **Node.js** - v18+ recommended

### Installation

1. **Install dependencies** from the monorepo root:

   ```bash
   cd /path/to/gremlin
   bun install
   ```

2. **Build the recorder-web package**:

   ```bash
   bun run build
   ```

3. **Navigate to the example**:

   ```bash
   cd examples/web-app
   ```

4. **Start the dev server**:

   ```bash
   bun run dev
   ```

5. **Open your browser**:

   Visit `http://localhost:5173` (or the port shown in terminal)

## Usage Guide

### Recording a Session

1. **Start Recording**
   - Click the "Start Recording" button in the purple control bar at the top
   - Or use keyboard shortcut: `Ctrl+Shift+R`
   - Status indicator will turn red and pulse

2. **Interact with the App**
   - Browse products and filter by category
   - Add items to cart
   - Update quantities
   - Navigate to checkout
   - Fill out the checkout form
   - Watch the event count increase in real-time
   - **Note**: Recording persists across page navigation automatically

3. **Stop Recording**
   - Click "Stop Recording" button
   - Or use keyboard shortcut: `Ctrl+Shift+R` again
   - Status indicator will turn gray

4. **Export Session**
   - Click "Export JSON" button
   - Session will download as `gremlin-session-<id>.json`
   - Check your browser's download folder

### Analyzing Sessions

#### In the Browser Console

The app exposes debug utilities via `window.gremlinDebug`:

```javascript
// Get current session
gremlinDebug.getSession()

// Analyze session statistics
gremlinDebug.analyze()
// Output:
// {
//   sessionId: "abc123",
//   duration: 45230,
//   eventCount: 23,
//   eventTypes: { TAP: 15, INPUT: 5, NAVIGATION: 3 },
//   elementsWithTestIds: 18,
//   testIdCoverage: "95%"
// }

// Get all events
gremlinDebug.getEvents()

// Get events by type
gremlinDebug.getEvents('tap')       // All tap/click events
gremlinDebug.getEvents('input')     // All input events
gremlinDebug.getEvents('navigation') // All navigation events

// Get all captured elements
gremlinDebug.getElements()

// Get only elements with test IDs
gremlinDebug.getElementsWithTestIds()

// Export to console
gremlinDebug.exportConsole()
```

#### Session JSON Structure

```json
{
  "header": {
    "sessionId": "abc123",
    "startTime": 1701234567890,
    "endTime": 1701234612120,
    "device": {
      "platform": "web",
      "osVersion": "macOS 14.1",
      "screen": { "width": 1920, "height": 1080 },
      "userAgent": "Mozilla/5.0..."
    },
    "app": {
      "name": "Gremlin Demo Shop",
      "version": "1.0.0",
      "identifier": "http://localhost:5173"
    }
  },
  "events": [
    {
      "type": 0,
      "dt": 150,
      "data": {
        "kind": "tap",
        "x": 450,
        "y": 320,
        "elementIndex": 5
      }
    }
  ],
  "elements": [
    {
      "testId": "product-add-to-cart-1",
      "role": "button",
      "label": "Add to Cart",
      "tagName": "BUTTON",
      "className": "btn btn-primary",
      "xpath": "/html/body/main/div/div[1]/button"
    }
  ]
}
```

## Project Structure

```
web-app/
├── index.html          # Home page
├── products.html       # Product listing page
├── cart.html          # Shopping cart page
├── checkout.html      # Checkout flow page
├── js/
│   ├── app.js         # Cart state, product rendering, checkout logic
│   └── recorder.js    # Gremlin SDK integration and controls
├── css/
│   └── style.css      # All styling (CSS Grid, Flexbox, animations)
├── package.json       # Dependencies and scripts
└── README.md         # This file
```

## Test ID Patterns

All interactive elements follow consistent naming patterns:

### Navigation
- `nav-logo` - Logo/home link
- `nav-home` - Home nav link
- `nav-products` - Products nav link
- `nav-cart` - Cart nav link

### Products Page
- `category-filter` - Category dropdown
- `sort-filter` - Sort dropdown
- `product-card-{id}` - Product card container
- `product-add-to-cart-{id}` - Add to cart button
- `product-view-details-{id}` - View details button
- `product-detail-add-to-cart-{id}` - Add to cart in modal

### Cart Page
- `cart-item-{id}` - Cart item row
- `cart-qty-input-{id}` - Quantity input
- `cart-increase-qty-{id}` - Increase quantity button
- `cart-decrease-qty-{id}` - Decrease quantity button
- `cart-remove-item-{id}` - Remove item button
- `cart-checkout-btn` - Proceed to checkout
- `promo-code-input` - Promo code input
- `promo-apply-btn` - Apply promo button

### Checkout Page
- `checkout-email` - Email input
- `checkout-first-name` - First name input
- `checkout-last-name` - Last name input
- `checkout-address` - Address input
- `checkout-city` - City input
- `checkout-state` - State dropdown
- `checkout-zip` - ZIP code input
- `checkout-phone` - Phone input
- `checkout-card-number` - Card number input
- `checkout-expiry` - Expiry date input
- `checkout-cvv` - CVV input
- `continue-to-payment-btn` - Continue button
- `continue-to-review-btn` - Review order button
- `place-order-btn` - Place order button

### Recorder Controls
- `recorder-start-btn` - Start recording
- `recorder-stop-btn` - Stop recording
- `recorder-export-btn` - Export JSON

## Example User Flow

Here's a typical user journey you can record:

1. **Start on Home Page**
   - Click "Start Recording"
   - Click "Browse Products"

2. **Browse Products**
   - Filter by "Electronics"
   - Sort by "Price: Low to High"
   - Click "Add to Cart" on Wireless Headphones
   - View details of Smart Watch
   - Add Smart Watch to cart from modal

3. **View Cart**
   - Navigate to Cart
   - Increase quantity of Wireless Headphones to 2
   - Try promo code "GREMLIN10"
   - Click "Proceed to Checkout"

4. **Complete Checkout**
   - Fill in email: test@example.com
   - Fill in name: John Doe
   - Fill in address details
   - Continue to payment
   - Enter card details (use test card: 4242 4242 4242 4242)
   - Continue to review
   - Check "Agree to terms"
   - Place order

5. **Export Session**
   - Click "Stop Recording"
   - Click "Export JSON"
   - Analyze the exported session

This flow will capture:
- ~25-30 user events (taps, inputs, navigation)
- ~20-25 unique elements with testIds
- Full checkout funnel from browse to purchase

## Configuration

The recorder can be configured in `js/recorder.js`:

```javascript
const recorder = new GremlinRecorder({
  appName: 'Gremlin Demo Shop',
  appVersion: '1.0.0',
  appBuild: '001',

  // Auto-start recording on page load
  autoStart: false,

  // Capture performance metrics
  capturePerformance: true,
  performanceInterval: 5000,

  // Mask sensitive inputs (passwords, emails)
  maskInputs: true,

  // Persist session across page navigation
  persistSession: true,

  // Real-time event callback
  onEvent: (event) => {
    console.log('Event captured:', event);
  },

  // Custom rrweb options
  rrwebOptions: {
    sampling: {
      scroll: 150,
      mousemove: false,
      input: 'last'
    }
  }
});
```

## Customization

### Adding New Pages

1. Create HTML file with recorder controls and navigation
2. Add page-specific logic in `js/app.js`
3. Initialize in the DOMContentLoaded handler
4. Add test IDs to all interactive elements

### Adding Test IDs

Follow the pattern: `{component}-{action}-{id}`

```html
<button data-testid="product-add-to-cart-5">
  Add to Cart
</button>

<input
  type="text"
  data-testid="checkout-email"
  placeholder="email@example.com"
>
```

## Troubleshooting

### Recorder not starting

- Ensure `@gremlin/recorder-web` is built: `cd ../.. && bun run build`
- Check browser console for errors
- Verify Vite dev server is running

### Events not captured

- Check recording status indicator (should be red and pulsing)
- Open console and check `gremlinDebug.getSession()`
- Verify elements have `data-testid` attributes

### Export button disabled

- You must stop recording before exporting
- Check that a session exists: `gremlinDebug.getSession()`

## Development

### Building for Production

```bash
bun run build
```

Output will be in `dist/` directory. Serve with any static file server.

### Preview Production Build

```bash
bun run preview
```

## Next Steps

After recording a session:

1. **Analyze the JSON** - Review captured events and elements
2. **Generate Tests** - Use the session with Gremlin CLI to generate test code
3. **Integrate CI/CD** - Add generated tests to your test suite
4. **Monitor Coverage** - Track which user flows are tested

## Resources

- **Gremlin Core Docs**: See main project README
- **rrweb**: https://www.rrweb.io/ (underlying DOM recording library)
- **Vite**: https://vitejs.dev/

## License

Part of the Gremlin project. See root LICENSE file.

## Questions?

Open an issue in the main Gremlin repository or check the project documentation.
