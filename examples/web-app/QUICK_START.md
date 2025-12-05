# Quick Start - Gremlin Web Demo

Get up and running in 60 seconds.

## 1. Install & Build

```bash
# From gremlin root directory
bun install
bun run build
```

## 2. Start Demo

```bash
cd examples/web-app
bun run dev
```

Browser opens to `http://localhost:5173`

## 3. Record a Session

1. ✅ Click **"Start Recording"** (top purple bar)
2. 🛒 Add items to cart
3. 📝 Complete checkout form
4. ⏹️ Click **"Stop Recording"**
5. 💾 Click **"Export JSON"**

## 4. Analyze Session

Open browser console (F12):

```javascript
gremlinDebug.analyze()
```

## That's It!

📖 Full docs: See [README.md](README.md)
🎬 Detailed demo: See [DEMO_SCRIPT.md](DEMO_SCRIPT.md)

## Keyboard Shortcut

`Ctrl+Shift+R` - Start/Stop recording

## Console Commands

```javascript
gremlinDebug.getSession()           // Current session
gremlinDebug.analyze()              // Session stats
gremlinDebug.getEvents('tap')       // Tap events
gremlinDebug.getElementsWithTestIds() // Elements
```

## Test ID Patterns

- `product-add-to-cart-1` - Add product 1 to cart
- `checkout-email` - Email input field
- `cart-checkout-btn` - Checkout button
- `nav-products` - Products nav link

All interactive elements have unique `data-testid` attributes!
