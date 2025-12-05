# Architecture Overview

This document provides a high-level overview of the Gremlin Expo demo app architecture.

## Application Structure

```
expo-app/
├── app/                    # Expo Router screens (file-based routing)
├── components/             # Reusable UI components
├── store/                  # State management (Zustand)
├── lib/                    # Libraries and utilities
├── types/                  # TypeScript type definitions
└── assets/                 # Images, fonts, etc.
```

## Technology Stack

### Core
- **Expo SDK 54**: React Native framework
- **React Native 0.81**: Mobile runtime
- **TypeScript 5.9**: Type safety

### Navigation
- **Expo Router 6**: File-based routing system
  - Uses React Navigation under the hood
  - Automatic deep linking
  - Type-safe navigation

### State Management
- **Zustand 5**: Lightweight state management
  - Simple API
  - No boilerplate
  - React hooks integration

### Development
- **Bun**: Fast JavaScript runtime and package manager
- **TypeScript**: Compile-time type checking

## Routing (Expo Router)

Expo Router uses a file-based routing system where files in the `app/` directory automatically become routes:

```
app/
├── _layout.tsx         → Root layout (wraps all screens)
├── index.tsx           → / (Home screen)
├── products.tsx        → /products
├── product/
│   └── [id].tsx        → /product/:id (Dynamic route)
├── cart.tsx            → /cart
└── checkout.tsx        → /checkout
```

### Navigation API

```tsx
import { useRouter } from 'expo-router';

const router = useRouter();
router.push('/products');           // Navigate to products
router.push('/product/1');          // Navigate to product detail
router.back();                       // Go back
```

## State Management (Zustand)

The cart state is managed globally using Zustand:

```tsx
// store/cart.ts
export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  addItem: (product) => { /* ... */ },
  removeItem: (id) => { /* ... */ },
  updateQuantity: (id, qty) => { /* ... */ },
  clearCart: () => { /* ... */ },
  getTotal: () => { /* ... */ },
  getItemCount: () => { /* ... */ },
}));
```

### Usage in Components

```tsx
// Access state and actions
const items = useCartStore((state) => state.items);
const addItem = useCartStore((state) => state.addItem);

// Use in handler
const handleAddToCart = () => {
  addItem(product);
};
```

## Gremlin Recorder Integration

### Initialization

The recorder is initialized once in the root layout:

```tsx
// app/_layout.tsx
import { initGremlin } from '../lib/gremlin';

export default function RootLayout() {
  useEffect(() => {
    initGremlin({ debug: true });
  }, []);

  return <Stack>{/* screens */}</Stack>;
}
```

### Screen Tracking

Each screen sets its name on mount:

```tsx
// app/products.tsx
export default function ProductsScreen() {
  useEffect(() => {
    getGremlin().setScreen('products');
  }, []);

  // ...
}
```

### Event Recording

Components record interactions automatically:

```tsx
// components/Button.tsx
const handlePress = () => {
  getGremlin().recordTap(testID, { action: 'button_press', title });
  onPress();
};
```

### Event Types

1. **Tap Events**: Button presses, card taps
2. **Scroll Events**: ScrollView interactions
3. **Input Events**: Text field changes
4. **Navigation Events**: Screen transitions

## Component Architecture

### Component Hierarchy

```
RootLayout (_layout.tsx)
├── HomeScreen (index.tsx)
│   ├── Button (multiple)
│   └── Feature cards
├── ProductsScreen (products.tsx)
│   ├── ProductCard (list)
│   └── Button
├── ProductDetailScreen (product/[id].tsx)
│   └── Button
├── CartScreen (cart.tsx)
│   ├── CartItem (list)
│   └── Button
└── CheckoutScreen (checkout.tsx)
    ├── TextInput (multiple)
    └── Button
```

### Reusable Components

#### Button
- Standard button with variants (primary, secondary, danger)
- Automatic Gremlin event recording
- Press state styling
- Disabled state support

```tsx
<Button
  title="Add to Cart"
  testID="product-1-add-to-cart-button"
  variant="primary"
  onPress={handleAddToCart}
/>
```

#### ProductCard
- Product display with image, name, category, price
- Pressable for navigation
- Automatic event recording

```tsx
<ProductCard
  product={product}
  testID={`products-product-card-${product.id}`}
  onPress={() => router.push(`/product/${product.id}`)}
/>
```

#### CartItem
- Cart item with product info
- Quantity controls (increment/decrement)
- Remove button
- Subtotal calculation

```tsx
<CartItem
  item={item}
  testID={`cart-item-${item.product.id}`}
  onUpdateQuantity={(qty) => updateQuantity(item.product.id, qty)}
  onRemove={() => removeItem(item.product.id)}
/>
```

## Data Flow

### Adding to Cart

```
ProductDetailScreen
    ↓ (user taps "Add to Cart")
    ↓ recordTap()
    ↓ useCartStore.addItem()
    ↓ Zustand updates state
    ↓ All components re-render with new cart count
```

### Checkout Flow

```
CheckoutScreen
    ↓ (user fills form)
    ↓ recordInput() for each field
    ↓ (user taps "Submit")
    ↓ validateForm()
    ↓ (if valid)
    ↓ useCartStore.clearCart()
    ↓ router.push('/')
```

## Testing Strategy

### TestID Coverage

Every interactive element has a unique testID for:
- E2E testing (Detox, Appium)
- Session replay identification
- Analytics tracking

### Type Safety

TypeScript ensures:
- Correct prop types
- Valid navigation routes
- State management type safety

### Manual Testing Checklist

- [ ] Navigate through all screens
- [ ] Add items to cart
- [ ] Update quantities
- [ ] Remove items
- [ ] Checkout flow validation
- [ ] Check Gremlin console logs

## Performance Considerations

### Optimizations
- Zustand for minimal re-renders
- React Navigation for smooth transitions
- ScrollView with testID tracking
- Debounced scroll event recording

### Future Optimizations
- FlatList for large product lists
- Image caching
- Memoized components
- Virtual scrolling

## Development Workflow

### Starting Development

```bash
cd examples/expo-app
bun install
bun start
```

### Running on Platforms

```bash
bun ios         # iOS simulator
bun android     # Android emulator
bun web         # Web browser
```

### Type Checking

```bash
bun run lint    # TypeScript type checking
```

### Clear Cache

```bash
bun run clear   # Clear Metro bundler cache
```

## Extending the App

### Adding a New Screen

1. Create file in `app/` directory
2. Add to Stack in `_layout.tsx` (optional, auto-detected)
3. Implement screen with testIDs
4. Set screen name with Gremlin

```tsx
// app/favorites.tsx
export default function FavoritesScreen() {
  useEffect(() => {
    getGremlin().setScreen('favorites');
  }, []);

  return (
    <View>
      <Button
        title="Go Back"
        testID="favorites-back-button"
        onPress={() => router.back()}
      />
    </View>
  );
}
```

### Adding a New Component

1. Create file in `components/` directory
2. Define props with testID required
3. Implement with Gremlin recording
4. Export from `components/index.ts`

```tsx
// components/ProductList.tsx
interface ProductListProps {
  products: Product[];
  testID: string;
}

export function ProductList({ products, testID }: ProductListProps) {
  return (
    <View testID={testID}>
      {products.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          testID={`${testID}-card-${product.id}`}
          onPress={() => {/* ... */}}
        />
      ))}
    </View>
  );
}
```

### Adding New State

1. Create store file in `store/` directory
2. Define store interface
3. Implement with Zustand
4. Use in components

```tsx
// store/favorites.ts
interface FavoritesStore {
  favorites: string[];
  addFavorite: (id: string) => void;
  removeFavorite: (id: string) => void;
}

export const useFavoritesStore = create<FavoritesStore>((set) => ({
  favorites: [],
  addFavorite: (id) => set((state) => ({
    favorites: [...state.favorites, id]
  })),
  removeFavorite: (id) => set((state) => ({
    favorites: state.favorites.filter(fav => fav !== id)
  })),
}));
```

## Deployment

### Building for Production

```bash
# iOS
eas build --platform ios

# Android
eas build --platform android
```

### Publishing Updates

```bash
eas update --branch production
```

## Resources

- [Expo Documentation](https://docs.expo.dev/)
- [Expo Router Documentation](https://docs.expo.dev/router/introduction/)
- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [React Native Documentation](https://reactnative.dev/)
