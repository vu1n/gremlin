import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ProductCard } from '../components/ProductCard';
import { Button } from '../components/Button';
import { MOCK_PRODUCTS } from '../lib/mockData';
import { useCartStore } from '../store/cart';

export default function ProductsScreen() {
  const router = useRouter();
  const itemCount = useCartStore((state) => state.getItemCount());

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="products-scroll-view"
      >
        <View style={styles.header}>
          <Text style={styles.title}>All Products</Text>
          <Text style={styles.subtitle}>
            {MOCK_PRODUCTS.length} items available
          </Text>
        </View>

        <View style={styles.products}>
          {MOCK_PRODUCTS.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              testID={`products-product-card-${product.id}`}
              onPress={() => router.push(`/product/${product.id}`)}
            />
          ))}
        </View>

        {itemCount > 0 && (
          <View style={styles.cartAction}>
            <Button
              title={`View Cart (${itemCount})`}
              testID="products-view-cart-button"
              onPress={() => router.push('/cart')}
            />
          </View>
        )}
      </ScrollView>
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
  products: {
    gap: 0,
  },
  cartAction: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
});
