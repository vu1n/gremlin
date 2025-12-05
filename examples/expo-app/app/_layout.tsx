import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { initGremlin } from '../lib/gremlin';

export default function RootLayout() {
  useEffect(() => {
    // Initialize Gremlin recorder with debug mode enabled
    initGremlin({ debug: true });
  }, []);

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#007AFF',
          },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {
            fontWeight: '600',
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Home',
          }}
        />
        <Stack.Screen
          name="products"
          options={{
            title: 'Products',
          }}
        />
        <Stack.Screen
          name="product/[id]"
          options={{
            title: 'Product Details',
          }}
        />
        <Stack.Screen
          name="cart"
          options={{
            title: 'Shopping Cart',
          }}
        />
        <Stack.Screen
          name="checkout"
          options={{
            title: 'Checkout',
          }}
        />
      </Stack>
    </>
  );
}
