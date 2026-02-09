# Gremlin Demo Shop - Expo Example

An e-commerce demo app built with Expo Router and React Native, showcasing the **@gremlin/recorder-react-native** SDK for session recording and test generation.

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- iOS Simulator (macOS) or Android Emulator
- Expo Go app (for physical devices)

## Getting Started

From the monorepo root:

```bash
# 1. Install all dependencies
bun install

# 2. Start the Expo dev server
cd examples/expo-app
bun run start

# 3. Press 'i' for iOS simulator or 'a' for Android emulator
```

## App Structure

```
expo-app/
├── app/
│   ├── _layout.tsx        # Root layout with GremlinProvider
│   ├── index.tsx           # Home screen with recorder controls
│   ├── products.tsx        # Product listing
│   ├── product/[id].tsx    # Product detail (dynamic route)
│   ├── cart.tsx            # Shopping cart
│   └── checkout.tsx        # Checkout flow
├── components/
│   ├── Button.tsx          # Reusable button with testID
│   ├── RecorderWidget.tsx  # Floating recorder controls
│   ├── ProductCard.tsx     # Product display card
│   └── CartItem.tsx        # Cart item row
├── lib/
│   ├── gremlin.ts          # GremlinProvider + useGremlin hook
│   └── mockData.ts         # Mock product data
├── store/
│   └── cart.ts             # Zustand cart state
└── package.json
```

## How Recording Works

The `_layout.tsx` wraps the app with `GremlinProvider`, which initializes the recorder once at the root:

```tsx
<GremlinProvider
  config={{
    appName: 'Gremlin Demo Shop',
    appVersion: '1.0.0',
    captureAppState: true,
    enableBatching: true,
    debug: true,
  }}
  autoStart
>
  <Slot />
  <RecorderWidget />
</GremlinProvider>
```

The recorder automatically captures:
- **Taps** on all Pressable/TouchableOpacity elements
- **Navigation** between Expo Router screens
- **Scroll** events on ScrollView/FlatList
- **Text input** changes (masked for privacy by default)
- **App state** transitions (foreground/background)
- **Performance** metrics (FPS, memory, JS thread lag)

Every interactive element uses `testID` for identification:

```tsx
<Button title="Add to Cart" testID="product-add-to-cart-1" onPress={...} />
```

## Recording and Exporting Sessions

1. Launch the app — recording starts automatically
2. Browse products, add to cart, go through checkout
3. Use the floating `RecorderWidget` or the home screen controls:
   - **View Stats** — see event counts by type
   - **Export Session** — share the session JSON via the Share sheet or console

The exported session JSON can be used directly with the Gremlin CLI.

## Using Sessions with Gremlin CLI

### Option 1: Copy exported session

```bash
# Copy the session JSON to your project's sessions directory
cp gremlin-session-*.json .gremlin/sessions/

# Generate Maestro tests for mobile
gremlin generate --maestro --app-id com.example.app

# Or Playwright tests for Expo web
gremlin generate --playwright --base-url http://localhost:8081
```

### Option 2: Live recording via dev server

Configure the recorder to send sessions to `gremlin dev`:

```bash
# Terminal 1: Start the Gremlin dev server
gremlin dev --port 3334

# Terminal 2: Start the Expo dev server
cd examples/expo-app
bun run start
```

Then update `_layout.tsx` to point the recorder at the dev server:

```tsx
<GremlinProvider
  config={{
    appName: 'Gremlin Demo Shop',
    appVersion: '1.0.0',
    serverUrl: 'http://localhost:3334',  // Send sessions to gremlin dev
  }}
  autoStart
>
```

### Generating and running tests

```bash
# List recorded sessions
gremlin sessions

# Generate tests
gremlin generate --maestro

# Generate fuzz tests
gremlin fuzz --strategy all --count 10

# Run tests
gremlin run
```

## TestID Patterns

| Screen | Element | testID |
|--------|---------|--------|
| Home | Scroll view | `home-scroll-view` |
| Home | Browse products | `home-browse-products-button` |
| Home | View cart | `home-view-cart-button` |
| Home | Toggle recording | `recorder-toggle-button` |
| Home | View stats | `recorder-stats-button` |
| Home | Export session | `recorder-export-button` |
| Products | Product card | `products-product-card-{id}` |
| Products | View cart | `products-view-cart-button` |
| Product | Add to cart | `product-{id}-add-to-cart-button` |
| Cart | Cart item | `cart-item-{id}` |
| Cart | Increment qty | `cart-item-{id}-increment` |
| Cart | Decrement qty | `cart-item-{id}-decrement` |
| Cart | Remove item | `cart-item-{id}-remove` |
| Cart | Checkout | `cart-checkout-button` |
| Checkout | Name input | `checkout-name-input` |
| Checkout | Email input | `checkout-email-input` |
| Checkout | Submit | `checkout-submit-button` |

## Tech Stack

- **Expo** ~54 with Expo Router v6
- **React Native** 0.81
- **Zustand** v5 for state management
- **TypeScript** 5.9

## Example User Flow

1. **Home** — tap "Browse Products"
2. **Products** — scroll, tap a product card
3. **Product Detail** — tap "Add to Cart"
4. **Cart** — adjust quantities, tap "Checkout"
5. **Checkout** — fill form, place order

This captures ~20-30 events with navigation, taps, inputs, and scroll data — enough for Gremlin to generate a full Maestro test suite.
