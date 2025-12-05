# Demo Script - Gremlin Web Recorder

Follow this script to demonstrate the full capabilities of the Gremlin recorder SDK.

## Setup (1 minute)

```bash
# From the gremlin root directory
cd examples/web-app
bun run dev
```

Browser should open to `http://localhost:5173`

## Demo Flow (5 minutes)

### Part 1: Start Recording (30 seconds)

1. **Point out the recorder controls** at the top of the page
   - Purple control bar with status indicator
   - Start/Stop/Export buttons
   - Event counter

2. **Click "Start Recording"**
   - Status turns red and pulses
   - Event count shows "0 events"
   - Mention keyboard shortcut: `Ctrl+Shift+R`

3. **Show the test IDs**
   - Open DevTools (F12)
   - Inspect any button/link
   - Point out `data-testid` attributes
   - Example: `data-testid="nav-products"`

### Part 2: Capture User Journey (2 minutes)

#### Browse Products
1. Click "Browse Products" button
   - Event count increments (TAP event captured)
   - Navigation event recorded

2. Filter products
   - Select "Electronics" from Category dropdown
   - Select "Price: Low to High" from Sort dropdown
   - Events: 2 INPUT events

3. Add to cart
   - Click "Add to Cart" on Wireless Headphones
   - Button shows "✓ Added" feedback
   - Cart badge updates to "1"
   - Event: 1 TAP event

4. View product details
   - Click "Details" on Smart Watch
   - Modal opens
   - Click "Add to Cart" in modal
   - Modal closes, cart badge now "2"
   - Events: 2 TAP events

#### Shopping Cart
5. Navigate to Cart
   - Click "Cart" in navigation
   - Events: 1 TAP + 1 NAVIGATION event

6. Update quantities
   - Click "+" button on Wireless Headphones twice
   - Quantity changes from 1 to 3
   - Price updates automatically
   - Events: 2 TAP events

7. Apply promo code
   - Type "GREMLIN10" in promo code input
   - Click "Apply" button
   - Success message appears
   - Events: 1 INPUT + 1 TAP event

#### Checkout Flow
8. Proceed to checkout
   - Click "Proceed to Checkout" button
   - Events: 1 TAP + 1 NAVIGATION event

9. Fill shipping information
   - Email: "demo@gremlin.dev"
   - First name: "Alice"
   - Last name: "Developer"
   - Address: "123 Test Lane"
   - City: "San Francisco"
   - State: Select "California"
   - ZIP: "94102"
   - Phone: "(555) 123-4567"
   - Click "Continue to Payment"
   - Events: ~8 INPUT + 1 TAP event

10. Fill payment information
    - Card: "4242 4242 4242 4242"
    - Expiry: "12/25"
    - CVV: "123"
    - Check "Save card" checkbox
    - Click "Review Order"
    - Events: 3 INPUT + 1 TAP + 1 TAP events

11. Complete order
    - Check "I agree to terms"
    - Click "Place Order"
    - Success page appears
    - Events: 1 TAP + 1 TAP event

**Total Events Captured: ~30-35 events**

### Part 3: Export and Analyze (2 minutes)

#### Stop Recording
1. **Click "Stop Recording"**
   - Status indicator turns gray
   - Final event count shown (e.g., "34 events")
   - Console shows session summary

2. **Open Browser Console** (F12)
   ```javascript
   // Show session analysis
   gremlinDebug.analyze()
   ```

   **Expected output:**
   ```
   {
     sessionId: "abc123...",
     duration: 120000,        // ~2 minutes
     eventCount: 34,
     eventTypes: {
       TAP: 20,
       INPUT: 11,
       NAVIGATION: 3
     },
     elementsWithTestIds: 25,
     testIdCoverage: "100%"
   }
   ```

3. **Explore captured events**
   ```javascript
   // Get all tap events
   gremlinDebug.getEvents('tap')

   // Get all input events
   gremlinDebug.getEvents('input')

   // Get elements with test IDs
   gremlinDebug.getElementsWithTestIds()
   ```

4. **Export session JSON**
   - Click "Export JSON" button
   - File downloads: `gremlin-session-<id>.json`
   - Open in text editor to show structure

#### Review Session JSON
Open the downloaded JSON file and highlight:

1. **Session Header**
   ```json
   {
     "header": {
       "sessionId": "...",
       "startTime": 1701234567890,
       "endTime": 1701234687890,
       "device": {
         "platform": "web",
         "osVersion": "macOS 14.1"
       },
       "app": {
         "name": "Gremlin Demo Shop",
         "version": "1.0.0"
       }
     }
   }
   ```

2. **Sample Event**
   ```json
   {
     "type": 0,  // TAP
     "dt": 1500, // 1.5s since last event
     "data": {
       "kind": "tap",
       "x": 450,
       "y": 320,
       "elementIndex": 5
     }
   }
   ```

3. **Sample Element**
   ```json
   {
     "testId": "product-add-to-cart-1",
     "role": "button",
     "label": "Add to Cart",
     "tagName": "BUTTON",
     "className": "btn btn-primary btn-sm",
     "xpath": "/html/body/main/div[3]/div[1]/button[1]"
   }
   ```

## Key Talking Points

### Why This Matters

1. **Test ID Coverage**
   - Every interactive element has a unique `data-testid`
   - Gremlin captures these IDs automatically
   - No manual test writing needed

2. **Real User Flows**
   - Captures actual user behavior
   - Records timing between actions
   - Understands navigation context

3. **Element Metadata**
   - Multiple selectors: testId, role, label, xpath
   - Fallback strategies for robust tests
   - Accessibility information included

4. **Performance Data**
   - Memory usage tracked
   - Time since navigation
   - Performance bottlenecks visible

### Next Steps

After recording sessions:

1. **Generate Tests**
   ```bash
   gremlin generate session.json --output tests/
   ```

2. **Run Tests**
   ```bash
   playwright test  # or your test runner
   ```

3. **Integrate CI/CD**
   - Add generated tests to test suite
   - Run on every PR
   - Monitor coverage over time

## Common Questions

**Q: Does this slow down my app?**
A: Minimal overhead. rrweb is highly optimized, sampling reduces noise.

**Q: Can I use this with React/Vue/Angular?**
A: Yes! Works with any web framework or vanilla JS.

**Q: What about sensitive data?**
A: `maskInputs: true` masks passwords/emails automatically.

**Q: Can I customize what gets recorded?**
A: Yes, full configuration via `RecorderConfig` options.

**Q: How do I integrate with existing tests?**
A: Generated tests use standard Playwright/Puppeteer APIs.

## Advanced Demo (Optional)

### Show Error Tracking

1. Open Console
2. Type: `throw new Error("Demo error")`
3. Check `gremlinDebug.getEvents('error')`
4. Error captured with stack trace

### Show Performance Monitoring

1. While recording, check memory:
   ```javascript
   gremlinDebug.getEvents().map(e => e.perf?.memoryUsage)
   ```

2. Shows memory usage over time

### Show Custom Events

1. In console while recording:
   ```javascript
   // Add custom event (if API available)
   recorder.addCustomEvent({
     name: 'feature_flag_toggled',
     data: { flag: 'new_checkout', value: true }
   });
   ```

## Reset for Next Demo

1. Click "Start Recording" to begin new session
2. Or refresh page to clear cart/state
3. localStorage persists cart between reloads (demo persistence)

---

**Demo Duration: 5-7 minutes**
**Preparation: 1 minute**
**Total: ~8 minutes**
