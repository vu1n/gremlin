# Architecture Overview - Gremlin Web Demo

## Application Structure

```
┌─────────────────────────────────────────────────────────┐
│           Gremlin Recorder Controls (Global)            │
│  [Start Recording] [Stop Recording] [Export JSON]       │
│  Status: ⚫ Recording | Event Count: 34 events          │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Navigation Bar                        │
│  🧪 Gremlin Demo Shop    [Home] [Products] [Cart (2)]  │
└─────────────────────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
    ┌─────────┐       ┌─────────┐       ┌─────────┐
    │  Home   │       │Products │       │  Cart   │
    │  Page   │───────│  Page   │───────│  Page   │───────┐
    └─────────┘       └─────────┘       └─────────┘       │
                                                           ▼
                                                    ┌──────────┐
                                                    │Checkout  │
                                                    │  Page    │
                                                    └──────────┘
```

## File Architecture

```
web-app/
│
├── 📄 Configuration & Docs
│   ├── package.json           # Dependencies (Vite, recorder-web)
│   ├── vite.config.js         # Dev server config
│   ├── .gitignore             # Git ignore rules
│   ├── README.md              # Main documentation
│   ├── QUICK_START.md         # 60-second setup
│   ├── DEMO_SCRIPT.md         # Demo walkthrough
│   ├── FEATURES.md            # Feature checklist
│   ├── ARCHITECTURE.md        # This file
│   └── PROJECT_SUMMARY.md     # Complete overview
│
├── 🌐 HTML Pages (Views)
│   ├── index.html             # Home: Hero, features, CTA
│   ├── products.html          # Products: Grid, filters, modal
│   ├── cart.html              # Cart: Items, quantities, promo
│   └── checkout.html          # Checkout: Multi-step form
│
├── 💻 JavaScript (Logic)
│   ├── app.js                 # App logic & state
│   │   ├── ProductData        # 8 sample products
│   │   ├── CartManager        # Cart state & localStorage
│   │   ├── Products Page      # Rendering & filtering
│   │   ├── Cart Page          # Item management
│   │   └── Checkout Page      # Multi-step flow
│   │
│   └── recorder.js            # Gremlin integration
│       ├── GremlinRecorder    # SDK initialization
│       ├── UI Controls        # Start/Stop/Export
│       ├── Debug Utilities    # Console commands
│       └── Session Analysis   # Event/element analysis
│
└── 🎨 CSS (Styles)
    └── style.css              # Complete styling
        ├── CSS Variables      # Colors, spacing, shadows
        ├── Reset & Base       # Normalize styles
        ├── Components         # Buttons, cards, forms
        ├── Layouts            # Grid, flexbox, responsive
        ├── Pages              # Page-specific styles
        └── Animations         # Transitions, effects
```

## Data Flow

### Recording Flow

```
User Action
    │
    ▼
DOM Event (click, input, scroll)
    │
    ▼
recorder.js (Event Listener)
    │
    ▼
GremlinRecorder.handleEvent()
    │
    ├─────────────────┬─────────────────┐
    ▼                 ▼                 ▼
captureElement()  createEvent()   updateUI()
    │                 │                 │
    ▼                 ▼                 ▼
Element Metadata  Event Data     Event Counter++
    │                 │
    └────────┬────────┘
             ▼
    session.events.push(event)
    session.elements.push(element)
             │
             ▼
    onEvent callback (optional)
             │
             ▼
    Update UI (event count)
```

### Export Flow

```
User Clicks "Export JSON"
    │
    ▼
recorder.getSession()
    │
    ▼
JSON.stringify(session)
    │
    ▼
Create Blob
    │
    ▼
Create Download Link
    │
    ▼
trigger download (gremlin-session-<id>.json)
    │
    ▼
User's Downloads Folder
```

## Cart State Management

```
┌─────────────────────────────────────┐
│          CartManager                │
│  (Singleton, localStorage-backed)   │
└─────────────────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
addItem()  removeItem()  updateQuantity()
    │         │         │
    └─────────┼─────────┘
              ▼
        saveCart()
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
localStorage  notifyListeners()  updateUI()
              │
              ▼
        UI Components Re-render
        - Cart Badge
        - Cart Items List
        - Summary Totals
```

## Component Relationships

```
┌────────────────────────────────────────────────┐
│            Global Components                    │
│  - RecorderControls (all pages)                │
│  - Navigation (all pages)                       │
│  - Cart Badge (all pages)                       │
│  - Footer (all pages)                           │
└────────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌────────┐  ┌────────┐  ┌────────┐
   │Products│  │  Cart  │  │Checkout│
   │  Grid  │  │  List  │  │  Form  │
   └────────┘  └────────┘  └────────┘
        │           │           │
        └───────────┼───────────┘
                    ▼
            ┌───────────────┐
            │  CartManager  │
            │  (Shared)     │
            └───────────────┘
```

## Event Capture Architecture

```
Browser Event
    │
    ▼
┌─────────────────────────────────────┐
│      Event Listeners (capture)      │
│  - click → handleClick()            │
│  - input → handleInput()            │
│  - change → handleChange()          │
│  - scroll → handleScroll()          │
│  - popstate → handleNavigation()    │
│  - error → handleError()            │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│     Element Identification          │
│  1. Find interactive element        │
│  2. Extract data-testid             │
│  3. Get ARIA role & label           │
│  4. Generate XPath                  │
│  5. Capture className               │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│      Event Enrichment               │
│  - Add timestamp (dt)               │
│  - Add element reference            │
│  - Capture coordinates (x, y)       │
│  - Mask sensitive data              │
│  - Attach performance metrics       │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│      Session Storage                │
│  session.events.push(event)         │
│  session.elements.push(element)     │
└─────────────────────────────────────┘
```

## Checkout Flow State Machine

```
              ┌─────────┐
              │ STEP 1  │
              │Shipping │
              └────┬────┘
                   │ validate()
                   ▼
              ┌─────────┐
              │ STEP 2  │
              │ Payment │
              └────┬────┘
                   │ validate()
                   ▼
              ┌─────────┐
              │ STEP 3  │
              │ Review  │
              └────┬────┘
                   │ submit()
                   ▼
              ┌─────────┐
              │ SUCCESS │
              └─────────┘
                   │
                   ▼
              cart.clear()
```

## Test ID Naming Convention

```
Pattern: {component}-{action}-{identifier}

Examples:
  nav-home              # Navigation home link
  nav-products          # Navigation products link
  product-card-1        # Product 1 card container
  product-add-to-cart-1 # Add product 1 to cart button
  cart-item-2           # Cart item 2 row
  cart-qty-input-2      # Quantity input for item 2
  cart-increase-qty-2   # Increase quantity button
  cart-remove-item-2    # Remove item button
  checkout-email        # Checkout email field
  checkout-first-name   # Checkout first name field
  recorder-start-btn    # Start recording button
  recorder-export-btn   # Export JSON button

Categories:
  - nav-*               # Navigation elements
  - product-*-{id}      # Product elements
  - cart-*-{id}         # Cart elements
  - checkout-*          # Checkout form fields
  - recorder-*          # Recorder controls
```

## Technology Stack

```
┌─────────────────────────────────────┐
│         Browser Runtime             │
│  - ES6+ JavaScript                  │
│  - Web APIs (localStorage, etc)     │
│  - DOM Events                        │
└─────────────────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐
│ HTML5  │ │ CSS3   │ │  JS    │
│        │ │ Grid   │ │ ES6+   │
│Semantic│ │ Flex   │ │Modules │
└────────┘ └────────┘ └────────┘
              │
              ▼
┌─────────────────────────────────────┐
│     Development Tools               │
│  - Vite (dev server, HMR)           │
│  - Bun (package manager)            │
│  - TypeScript (recorder SDK)        │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│     Gremlin SDK Stack               │
│  - @gremlin/recorder-web            │
│  - @gremlin/core                    │
│  - rrweb (DOM recording)            │
└─────────────────────────────────────┘
```

## Performance Considerations

### Optimizations
- ✅ Event sampling (scroll throttled to 150ms)
- ✅ Mousemove disabled (reduces noise)
- ✅ Input sampling (last value only)
- ✅ Canvas recording disabled
- ✅ Font collection disabled
- ✅ Efficient CSS (no framework overhead)
- ✅ Minimal dependencies

### Memory Management
- ✅ Session data in memory only while recording
- ✅ Cart data in localStorage (limited size)
- ✅ Event deduplication
- ✅ Element caching by index

## Security Considerations

### Data Masking
- ✅ Passwords masked (type="password")
- ✅ Email inputs masked (configurable)
- ✅ Credit card numbers not stored (demo only)
- ✅ Sensitive fields marked with masked flag

### Best Practices
- ✅ No external script injection
- ✅ CSP-compatible code
- ✅ No eval() usage
- ✅ Sandboxed localStorage
- ✅ XSS-safe innerHTML alternatives

## Debugging Architecture

```
Browser Console
    │
    ▼
window.gremlinDebug
    │
    ├─── getSession() ────────► Current Session Object
    │
    ├─── analyze() ───────────► Session Statistics
    │                              - Event counts by type
    │                              - Test ID coverage
    │                              - Duration
    │
    ├─── getEvents(type) ─────► Filtered Events Array
    │
    ├─── getElements() ───────► All Elements Array
    │
    ├─── getElementsWithTestIds() ► Elements with Test IDs
    │
    └─── exportConsole() ─────► JSON.stringify(session)
```

## Build Pipeline

```
Source Files (.html, .js, .css)
    │
    ▼
Vite Dev Server (development)
    │ - Hot Module Replacement
    │ - Fast refresh
    │ - Source maps
    ▼
Browser (http://localhost:5173)

    OR

Source Files (.html, .js, .css)
    │
    ▼
Vite Build (production)
    │ - Minification
    │ - Tree shaking
    │ - Code splitting
    │ - Asset optimization
    ▼
dist/ folder (deployable)
```

## Deployment Architecture

```
┌─────────────────────────────────────┐
│       Static File Server            │
│  (Any: Vercel, Netlify, S3, etc)    │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         CDN (optional)              │
│  - Global edge caching              │
│  - Fast asset delivery              │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         User's Browser              │
│  - Single Page App                  │
│  - Client-side routing              │
│  - localStorage persistence         │
└─────────────────────────────────────┘
```

---

**Architecture Status**: ✅ Complete and Documented
**Last Updated**: December 4, 2024
