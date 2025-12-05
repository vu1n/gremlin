import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Button } from '../components/Button';
import { useCartStore } from '../store/cart';
import { getGremlin } from '../lib/gremlin';

export default function HomeScreen() {
  const router = useRouter();
  const itemCount = useCartStore((state) => state.getItemCount());

  useEffect(() => {
    try {
      getGremlin().setScreen('home');
    } catch (e) {
      // Gremlin not initialized yet
    }
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="home-scroll-view"
      >
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>🛍️</Text>
          <Text style={styles.heroTitle}>Welcome to Shop Demo</Text>
          <Text style={styles.heroSubtitle}>
            A demo e-commerce app showcasing Gremlin session recording
          </Text>
        </View>

        <View style={styles.features}>
          <Text style={styles.sectionTitle}>Features</Text>
          <View style={styles.featureCard}>
            <Text style={styles.featureEmoji}>📱</Text>
            <Text style={styles.featureTitle}>Session Recording</Text>
            <Text style={styles.featureDescription}>
              All interactions are recorded with testID tracking
            </Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureEmoji}>🔍</Text>
            <Text style={styles.featureTitle}>Element Identification</Text>
            <Text style={styles.featureDescription}>
              Every interactive element has a unique testID
            </Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureEmoji}>📊</Text>
            <Text style={styles.featureTitle}>Event Tracking</Text>
            <Text style={styles.featureDescription}>
              Taps, scrolls, and inputs are captured in real-time
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            title="Browse Products"
            testID="home-browse-products-button"
            onPress={() => router.push('/products')}
          />
          <Button
            title={`View Cart ${itemCount > 0 ? `(${itemCount})` : ''}`}
            testID="home-view-cart-button"
            variant="secondary"
            onPress={() => router.push('/cart')}
            style={styles.cartButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            This is a demo app for testing Gremlin session recording
          </Text>
          <Text style={styles.footerSubtext}>
            Check the console for recorded events
          </Text>
        </View>
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
  hero: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  heroEmoji: {
    fontSize: 80,
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 12,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  features: {
    marginTop: 32,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
  },
  featureCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  featureEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  featureDescription: {
    fontSize: 14,
    color: '#8E8E93',
    lineHeight: 20,
  },
  actions: {
    marginTop: 32,
    gap: 12,
  },
  cartButton: {
    marginTop: 4,
  },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 8,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#C7C7CC',
    textAlign: 'center',
  },
});
