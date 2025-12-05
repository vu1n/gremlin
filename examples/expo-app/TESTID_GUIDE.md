# TestID Guide

This document explains the testID naming conventions and patterns used throughout the Gremlin Expo demo app.

## Purpose

TestIDs serve as unique identifiers for interactive elements in React Native applications. They are essential for:
- **Session Replay**: Identifying which element was interacted with
- **Automated Testing**: Selecting elements in E2E tests
- **Analytics**: Tracking user behavior and interactions
- **Debugging**: Understanding user flows and identifying issues

## Naming Convention

We follow a consistent pattern for all testIDs:

```
{screen}-{element}-{action}-{identifier?}
```

### Components

1. **screen**: The name of the screen/page (lowercase)
   - Examples: `home`, `products`, `cart`, `checkout`

2. **element**: The type or name of the UI element (lowercase)
   - Examples: `button`, `card`, `input`, `item`, `scroll-view`

3. **action**: The action or purpose (lowercase, hyphenated)
   - Examples: `browse-products`, `add-to-cart`, `increment`, `decrement`, `submit`

4. **identifier** (optional): A unique identifier when multiple similar elements exist
   - Examples: product ID, item index, etc.

### Examples

| TestID | Screen | Element | Action | Identifier |
|--------|--------|---------|--------|------------|
| `home-browse-products-button` | home | button | browse-products | - |
| `products-product-card-1` | products | product-card | - | 1 |
| `cart-item-2-increment` | cart | item | increment | 2 |
| `checkout-name-input` | checkout | input | - | name |

## TestID by Screen

### Home Screen (`index.tsx`)

```typescript
home-scroll-view              // Main scroll container
home-browse-products-button   // Navigate to products
home-view-cart-button         // Navigate to cart
```

### Products Screen (`products.tsx`)

```typescript
products-scroll-view           // Main scroll container
products-product-card-1        // Product card for product ID 1
products-product-card-2        // Product card for product ID 2
products-product-card-{id}     // Pattern for all product cards
products-view-cart-button      // Navigate to cart (when items > 0)
```

### Product Detail Screen (`product/[id].tsx`)

```typescript
product-{id}-scroll-view       // Main scroll container
product-{id}-add-to-cart-button // Add product to cart
```

Examples:
- `product-1-scroll-view`
- `product-1-add-to-cart-button`

### Cart Screen (`cart.tsx`)

```typescript
cart-scroll-view               // Main scroll container
cart-item-{id}                 // Cart item container
cart-item-{id}-increment       // Increase quantity
cart-item-{id}-decrement       // Decrease quantity
cart-item-{id}-remove          // Remove item from cart
cart-checkout-button           // Navigate to checkout
cart-clear-cart-button         // Clear all items
cart-empty-browse-button       // Navigate to products (empty state)
```

Examples:
- `cart-item-1`
- `cart-item-1-increment`
- `cart-item-1-decrement`
- `cart-item-1-remove`

### Checkout Screen (`checkout.tsx`)

```typescript
checkout-scroll-view           // Main scroll container
checkout-name-input            // Full name text input
checkout-email-input           // Email text input
checkout-address-input         // Street address text input
checkout-city-input            // City text input
checkout-zipCode-input         // ZIP code text input
checkout-cardNumber-input      // Card number text input
checkout-submit-button         // Submit order
checkout-empty-browse-button   // Navigate to products (empty state)
```

## Implementation Guidelines

### 1. Always Use TestID

Every interactive element MUST have a testID:
- Pressable
- TouchableOpacity
- Button
- TextInput
- Custom interactive components

```tsx
// ✅ Good
<Pressable testID="home-browse-products-button" onPress={handlePress}>
  <Text>Browse Products</Text>
</Pressable>

// ❌ Bad - Missing testID
<Pressable onPress={handlePress}>
  <Text>Browse Products</Text>
</Pressable>
```

### 2. Pass TestID Through Props

Reusable components should accept and use testID props:

```tsx
interface ButtonProps {
  testID: string;  // Required, not optional
  onPress: () => void;
  title: string;
}

export function Button({ testID, onPress, title }: ButtonProps) {
  return (
    <Pressable testID={testID} onPress={onPress}>
      <Text>{title}</Text>
    </Pressable>
  );
}
```

### 3. Use Descriptive Names

TestIDs should be self-documenting:

```tsx
// ✅ Good - Clear what it does
testID="products-view-cart-button"

// ❌ Bad - Unclear purpose
testID="products-button-1"
```

### 4. Handle Dynamic Content

For lists or dynamic content, include identifiers:

```tsx
// ✅ Good - Unique for each item
{products.map(product => (
  <ProductCard
    key={product.id}
    testID={`products-product-card-${product.id}`}
    product={product}
  />
))}

// ❌ Bad - Same testID for all items
{products.map(product => (
  <ProductCard
    key={product.id}
    testID="products-product-card"
    product={product}
  />
))}
```

### 5. Include Non-Interactive Elements

Add testIDs to scroll views and containers for context:

```tsx
<ScrollView testID="home-scroll-view">
  {/* content */}
</ScrollView>
```

## Best Practices

### DO:
- ✅ Use lowercase with hyphens
- ✅ Be consistent across the app
- ✅ Make testIDs descriptive
- ✅ Include screen name as prefix
- ✅ Add identifiers for dynamic content
- ✅ Document patterns in code comments

### DON'T:
- ❌ Use camelCase or PascalCase
- ❌ Include spaces or special characters
- ❌ Make them too generic ("button-1")
- ❌ Reuse the same testID
- ❌ Skip testIDs on interactive elements
- ❌ Change testIDs without documentation

## Gremlin Integration

The testID is automatically captured when recording events:

```typescript
// Button component
const handlePress = () => {
  getGremlin().recordTap(testID, { action: 'button_press', title });
  onPress();
};
```

This creates a recorded event like:
```json
{
  "type": "tap",
  "timestamp": 1234567890,
  "testID": "products-product-card-1",
  "screen": "products",
  "data": {
    "action": "product_card_tap",
    "productId": "1",
    "productName": "Wireless Headphones"
  }
}
```

## Testing TestIDs

### Manual Testing
1. Enable debug mode in Gremlin initialization
2. Interact with the app
3. Check console for recorded events with testIDs

### Automated Testing
```typescript
// Example with Detox or Appium
await element(by.id('home-browse-products-button')).tap();
await element(by.id('products-product-card-1')).tap();
await element(by.id('product-1-add-to-cart-button')).tap();
await element(by.id('checkout-name-input')).typeText('John Doe');
await element(by.id('checkout-submit-button')).tap();
```

## Maintenance

When adding new screens or features:

1. **Document the testIDs** in this file
2. **Follow the naming convention** strictly
3. **Update tests** if testIDs change
4. **Review in PR** to ensure consistency

## Quick Reference

| Context | Pattern | Example |
|---------|---------|---------|
| Navigation button | `{screen}-{destination}-button` | `home-browse-products-button` |
| Form input | `{screen}-{field}-input` | `checkout-email-input` |
| List item | `{screen}-{type}-{id}` | `products-product-card-1` |
| Item action | `{screen}-{type}-{id}-{action}` | `cart-item-2-increment` |
| Scroll container | `{screen}-scroll-view` | `products-scroll-view` |
| Modal/Dialog | `{screen}-{purpose}-modal` | `cart-confirm-clear-modal` |
| Tab | `{screen}-{tab}-tab` | `profile-settings-tab` |

## Resources

- [React Native Testing Library](https://callstack.github.io/react-native-testing-library/)
- [Detox Documentation](https://wix.github.io/Detox/)
- [Expo Testing Guide](https://docs.expo.dev/develop/unit-testing/)
