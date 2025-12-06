import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { CartItem } from '../components/CartItem';
import { Button } from '../components/Button';
import { useCartStore } from '../store/cart';

export default function CartScreen() {
  const router = useRouter();
  const { items, updateQuantity, removeItem, getTotal, clearCart } =
    useCartStore();

  const total = getTotal();

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>🛒</Text>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySubtitle}>
            Add some products to get started
          </Text>
          <View style={styles.emptyAction}>
            <Button
              title="Browse Products"
              testID="cart-empty-browse-button"
              onPress={() => router.push('/products')}
            />
          </View>
        </View>
      </View>
    );
  }

  const handleClearCart = () => {
    clearCart();
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="cart-scroll-view"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Shopping Cart</Text>
          <Text style={styles.subtitle}>{items.length} items</Text>
        </View>

        <View style={styles.items}>
          {items.map((item) => (
            <CartItem
              key={item.product.id}
              item={item}
              testID={`cart-item-${item.product.id}`}
              onUpdateQuantity={(quantity) =>
                updateQuantity(item.product.id, quantity)
              }
              onRemove={() => removeItem(item.product.id)}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <Button
            title="Clear Cart"
            testID="cart-clear-cart-button"
            variant="danger"
            onPress={handleClearCart}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalContainer}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>${total.toFixed(2)}</Text>
        </View>
        <Button
          title="Proceed to Checkout"
          testID="cart-checkout-button"
          onPress={() => router.push('/checkout')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
  },
  items: {
    marginBottom: 24,
  },
  actions: {
    marginTop: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  totalLabel: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
  },
  totalAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: '#007AFF',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 80,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 32,
  },
  emptyAction: {
    width: '100%',
    maxWidth: 300,
  },
});
