import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CartItem as CartItemType } from '../types';
import { getGremlin } from '../lib/gremlin';

interface CartItemProps {
  item: CartItemType;
  onUpdateQuantity: (quantity: number) => void;
  onRemove: () => void;
  testID: string;
}

export function CartItem({
  item,
  onUpdateQuantity,
  onRemove,
  testID,
}: CartItemProps) {
  const handleIncrement = () => {
    try {
      getGremlin().recordTap(`${testID}-increment`, {
        action: 'increment_quantity',
        productId: item.product.id,
        newQuantity: item.quantity + 1,
      });
    } catch (e) {
      // Gremlin not initialized, silently continue
    }
    onUpdateQuantity(item.quantity + 1);
  };

  const handleDecrement = () => {
    try {
      getGremlin().recordTap(`${testID}-decrement`, {
        action: 'decrement_quantity',
        productId: item.product.id,
        newQuantity: item.quantity - 1,
      });
    } catch (e) {
      // Gremlin not initialized, silently continue
    }
    onUpdateQuantity(item.quantity - 1);
  };

  const handleRemove = () => {
    try {
      getGremlin().recordTap(`${testID}-remove`, {
        action: 'remove_item',
        productId: item.product.id,
      });
    } catch (e) {
      // Gremlin not initialized, silently continue
    }
    onRemove();
  };

  const subtotal = item.product.price * item.quantity;

  return (
    <View testID={testID} style={styles.container}>
      <View style={styles.imageContainer}>
        <Text style={styles.emoji}>{item.product.image}</Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.name}>{item.product.name}</Text>
        <Text style={styles.price}>${item.product.price.toFixed(2)}</Text>
        <View style={styles.quantityContainer}>
          <Pressable
            testID={`${testID}-decrement`}
            onPress={handleDecrement}
            style={styles.quantityButton}
          >
            <Text style={styles.quantityButtonText}>-</Text>
          </Pressable>
          <Text style={styles.quantity}>{item.quantity}</Text>
          <Pressable
            testID={`${testID}-increment`}
            onPress={handleIncrement}
            style={styles.quantityButton}
          >
            <Text style={styles.quantityButtonText}>+</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.rightColumn}>
        <Pressable
          testID={`${testID}-remove`}
          onPress={handleRemove}
          style={styles.removeButton}
        >
          <Text style={styles.removeButtonText}>Remove</Text>
        </Pressable>
        <Text style={styles.subtotal}>${subtotal.toFixed(2)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  imageContainer: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
  },
  emoji: {
    fontSize: 32,
  },
  details: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  price: {
    fontSize: 14,
    color: '#8E8E93',
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quantityButton: {
    width: 32,
    height: 32,
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  quantity: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    minWidth: 24,
    textAlign: 'center',
  },
  rightColumn: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  removeButton: {
    padding: 4,
  },
  removeButtonText: {
    fontSize: 14,
    color: '#FF3B30',
  },
  subtotal: {
    fontSize: 18,
    fontWeight: '700',
    color: '#007AFF',
  },
});
