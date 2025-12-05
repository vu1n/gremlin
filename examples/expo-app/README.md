# Gremlin Expo Demo App

A demonstration e-commerce mobile application built with Expo and React Native to showcase the Gremlin session recording capabilities. This app implements comprehensive `testID` patterns for all interactive elements, making it ideal for testing session replay and user interaction tracking.

## Overview

This demo app simulates a simple e-commerce shopping experience with the following features:
- Product browsing and detailed views
- Shopping cart management
- Checkout flow with form validation
- Integration with Gremlin session recorder (placeholder implementation)

## Features

### 1. Complete E-Commerce Flow
- **Home Screen**: Welcome page with feature highlights
- **Products Screen**: Browse all available products
- **Product Detail**: View detailed product information
- **Shopping Cart**: Manage cart items and quantities
- **Checkout**: Complete purchase with form validation

### 2. Gremlin Integration
The app includes a placeholder implementation of the Gremlin recorder in `/lib/gremlin.ts`:
- Records user interactions (taps, scrolls, text input)
- Tracks navigation between screens
- Logs events with testID for element identification
- Debug mode for console output
- Ready to be upgraded to the full `@gremlin/recorder-react-native` package when ready

**Note**: The full `@gremlin/recorder-react-native` package is being built in parallel and will provide:
- Automatic gesture capture (taps, swipes, long presses)
- Navigation tracking with React Navigation
- Performance monitoring
- Session export in Gremlin format

### 3. TestID Best Practices
Every interactive element has a unique `testID` following the pattern:
```
{screen}-{element}-{action}
```

Examples:
- `home-browse-products-button`
- `products-product-card-1`
- `cart-item-2-increment`
- `checkout-submit-button`

## Tech Stack

- **Framework**: Expo ~54
- **Navigation**: Expo Router v6
- **State Management**: Zustand v5
- **Language**: TypeScript
- **Runtime**: React Native 0.81

## Project Structure

```
expo-app/
├── app/                      # Expo Router screens
│   ├── _layout.tsx          # Root layout with Gremlin initialization
│   ├── index.tsx            # Home screen
│   ├── products.tsx         # Product listing
│   ├── product/
│   │   └── [id].tsx         # Product detail (dynamic route)
│   ├── cart.tsx             # Shopping cart
│   └── checkout.tsx         # Checkout form
├── components/              # Reusable components
│   ├── Button.tsx           # Styled button with testID
│   ├── ProductCard.tsx      # Product display card
│   └── CartItem.tsx         # Cart item with quantity controls
├── store/
│   └── cart.ts              # Zustand cart store
├── lib/
│   ├── gremlin.ts           # Gremlin recorder (placeholder)
│   └── mockData.ts          # Mock product data
└── types/
    └── index.ts             # TypeScript interfaces
```

## Setup Instructions

### Prerequisites
- Node.js 18+ or Bun
- Expo CLI
- iOS Simulator (for Mac) or Android Emulator

### Installation

1. **Navigate to the project directory**:
   ```bash
   cd examples/expo-app
   ```

2. **Install dependencies**:
   ```bash
   bun install
   # or
   npm install
   ```

3. **Start the development server**:
   ```bash
   bun start
   # or
   npm start
   ```

4. **Run on your platform**:
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Press `w` for web browser
   - Scan QR code with Expo Go app on your device

## Gremlin Recorder Usage

### Initialization

The Gremlin recorder is automatically initialized in `app/_layout.tsx`:

```typescript
import { initGremlin } from '../lib/gremlin';

export default function RootLayout() {
  useEffect(() => {
    initGremlin({ debug: true });
  }, []);

  return <Stack>{/* Your screens */}</Stack>;
}
```

### Recording Events

The recorder automatically captures:
- **Taps**: All button and pressable interactions
- **Scrolls**: ScrollView movements
- **Input**: TextInput changes (values are masked for privacy)
- **Navigation**: Screen changes

Example event in console:
```
[Gremlin] Tap recorded: {
  testID: 'products-product-card-1',
  screen: 'products',
  data: { action: 'product_card_tap', productId: '1', productName: 'Wireless Headphones' }
}
```

### Exporting Sessions

To export the recorded session:

```typescript
import { getGremlin } from './lib/gremlin';

const session = getGremlin().exportSession();
console.log(session);
```

The session export includes:
- All recorded events with timestamps
- Session ID and duration
- Start and end times

## TestID Patterns

### Naming Convention
All testIDs follow this pattern:
```
{screen}-{element}-{action}-{identifier?}
```

### Examples by Screen

**Home Screen**:
- `home-scroll-view`
- `home-browse-products-button`
- `home-view-cart-button`

**Products Screen**:
- `products-scroll-view`
- `products-product-card-1`
- `products-product-card-2`
- `products-view-cart-button`

**Product Detail**:
- `product-1-scroll-view`
- `product-1-add-to-cart-button`

**Cart Screen**:
- `cart-scroll-view`
- `cart-item-1`
- `cart-item-1-increment`
- `cart-item-1-decrement`
- `cart-item-1-remove`
- `cart-checkout-button`
- `cart-clear-cart-button`

**Checkout Screen**:
- `checkout-scroll-view`
- `checkout-name-input`
- `checkout-email-input`
- `checkout-address-input`
- `checkout-city-input`
- `checkout-zipCode-input`
- `checkout-cardNumber-input`
- `checkout-submit-button`

## Development Notes

### Recorder API

The placeholder Gremlin recorder provides the following API:

```typescript
// GremlinRecorder methods
recorder.start()              // Start recording
recorder.stop()               // Stop recording
recorder.setScreen(name)      // Set current screen name
recorder.recordTap(testID, data) // Record tap event
recorder.recordScroll(data)   // Record scroll event
recorder.recordInput(testID, value) // Record input event
recorder.recordNavigation(from, to) // Record navigation
recorder.getEvents()          // Get all recorded events
recorder.exportSession()      // Export session as object
```

### Adding New Screens

1. Create a new file in `app/`
2. Add `useEffect` to set screen name with Gremlin
3. Add testIDs to all interactive elements
4. Follow the naming convention

Example:

```typescript
import { getGremlin } from '../lib/gremlin';

export default function MyScreen() {
  useEffect(() => {
    try {
      getGremlin().setScreen('my-screen');
    } catch (e) {
      // Gremlin not initialized yet
    }
  }, []);

  return (
    <View>
      <Button testID="my-screen-action-button" onPress={handleAction} />
    </View>
  );
}
```

### Testing TestIDs

You can verify testIDs are working by:
1. Debug mode is enabled by default in initialization
2. Check console logs for recorded events
3. Use React Native debugger to inspect elements
4. Export the session to inspect all captured events

## Mock Data

The app includes 6 mock products in `/lib/mockData.ts`:
- Wireless Headphones ($79.99)
- Smart Watch ($299.99)
- Laptop Backpack ($49.99)
- USB-C Hub ($34.99)
- Wireless Mouse ($24.99)
- Phone Case ($19.99)

Feel free to modify or add more products for testing.

## Future Enhancements

The full `@gremlin/recorder-react-native` package will provide:
- Automatic gesture capture (taps, swipes, long presses, double taps)
- React Navigation integration for automatic screen tracking
- Performance monitoring (FPS, memory usage, JS thread lag)
- Crash reporting integration
- Session upload to Gremlin servers
- Privacy controls for sensitive data masking
- Configuration options for sampling rate
- Element capture with bounds and hierarchy
- App state tracking (foreground/background)

## License

This is a demo application for the Gremlin project.
