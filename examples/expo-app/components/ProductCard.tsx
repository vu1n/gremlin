import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { Product } from '../types';

interface ProductCardProps {
  product: Product;
  onPress: () => void;
  testID: string;
}

export function ProductCard({ product, onPress, testID }: ProductCardProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.imageContainer}>
        <Text style={styles.emoji}>{product.image}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.category}>{product.category}</Text>
        <Text style={styles.price}>${product.price.toFixed(2)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  imageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 100,
    marginBottom: 12,
  },
  emoji: {
    fontSize: 64,
  },
  info: {
    gap: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  category: {
    fontSize: 14,
    color: '#8E8E93',
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: '#007AFF',
    marginTop: 4,
  },
});
