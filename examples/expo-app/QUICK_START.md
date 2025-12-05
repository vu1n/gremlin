# Quick Start Guide

Get the Gremlin Expo demo app running in 5 minutes.

## Prerequisites

- Node.js 18+ or Bun installed
- iOS Simulator (Mac only) or Android Emulator
- Expo Go app on physical device (optional)

## Installation

```bash
# Navigate to the project
cd /Users/vuln/code/gremlin/examples/expo-app

# Install dependencies
bun install

# Start the development server
bun start
```

## Running the App

After starting the dev server, you'll see a QR code and options:

### iOS Simulator (Mac only)
Press `i` or run:
```bash
bun ios
```

### Android Emulator
Press `a` or run:
```bash
bun android
```

### Physical Device
1. Install "Expo Go" from App Store or Google Play
2. Scan the QR code from the terminal
3. App will load on your device

### Web Browser
Press `w` or run:
```bash
bun web
```

## Testing the Gremlin Recorder

Once the app is running:

1. **Open the console** (if on web) or check terminal logs
2. **Interact with the app**:
   - Tap "Browse Products"
   - Tap on a product card
   - Tap "Add to Cart"
   - Navigate to cart
   - Adjust quantities
   - Proceed to checkout
   - Fill out the form

3. **Check the console** for Gremlin logs:
```
[Gremlin] Recording started
[Gremlin] Screen changed: home
[Gremlin] Tap recorded: { testID: 'home-browse-products-button', ... }
[Gremlin] Screen changed: products
[Gremlin] Tap recorded: { testID: 'products-product-card-1', ... }
```

## App Flow

```
Home Screen
    ↓
Products Screen
    ↓
Product Detail Screen
    ↓
Shopping Cart Screen
    ↓
Checkout Screen
    ↓
Order Confirmation (returns to Home)
```

## Common Commands

```bash
# Start dev server
bun start

# Start with clear cache
bun run clear

# Type checking
bun run lint

# Install new dependencies
bun add package-name

# Update dependencies
bun update
```

## Project Structure

```
expo-app/
├── app/                    # Screens (routes)
│   ├── index.tsx          # Home
│   ├── products.tsx       # Product list
│   ├── product/[id].tsx   # Product detail
│   ├── cart.tsx           # Shopping cart
│   └── checkout.tsx       # Checkout form
├── components/            # Reusable UI components
├── lib/                   # Gremlin recorder & utilities
├── store/                 # State management (Zustand)
└── types/                 # TypeScript definitions
```

## Key Features to Test

### 1. Product Browsing
- View all products
- Tap on a product to see details
- Check console for tap events

### 2. Cart Management
- Add items to cart
- Increment/decrement quantities
- Remove items
- Clear cart

### 3. Checkout Flow
- Fill out form fields
- Validation errors for invalid input
- Submit order

### 4. Gremlin Recording
- All taps recorded with testID
- Screen changes tracked
- Input events captured (values masked)
- Navigation events logged

## Troubleshooting

### Metro Bundler Issues
```bash
# Clear cache and restart
bun run clear
```

### Port Already in Use
```bash
# Kill process on port 8081
lsof -ti:8081 | xargs kill -9

# Start again
bun start
```

### TypeScript Errors
```bash
# Run type checking
bun run lint
```

### iOS Simulator Not Opening
```bash
# Open iOS simulator manually
open -a Simulator

# Then press 'i' in the terminal
```

### Dependencies Issues
```bash
# Remove and reinstall
rm -rf node_modules bun.lock
bun install
```

## Next Steps

1. **Explore the Code**
   - Check `lib/gremlin.ts` for recorder implementation
   - Review `TESTID_GUIDE.md` for naming conventions
   - Read `ARCHITECTURE.md` for system design

2. **Customize the App**
   - Add more products in `lib/mockData.ts`
   - Create new screens in `app/` directory
   - Add new components in `components/`

3. **Integrate Real Gremlin SDK**
   - When the RN SDK is ready, replace `lib/gremlin.ts`
   - Update initialization in `app/_layout.tsx`
   - Keep the testID patterns unchanged

## Useful Resources

- **README.md** - Full documentation
- **TESTID_GUIDE.md** - TestID naming conventions
- **ARCHITECTURE.md** - System architecture overview
- **Expo Docs** - https://docs.expo.dev/

## Support

For issues or questions:
1. Check the documentation files
2. Review Expo documentation
3. Check React Native documentation
4. Review the code comments

## Tips

- **Enable Debug Mode**: Already enabled in `app/_layout.tsx`
- **Check Console**: All Gremlin events are logged
- **Use TestIDs**: Every interactive element has one
- **Follow Patterns**: Consistent naming throughout

Happy testing! 🚀
