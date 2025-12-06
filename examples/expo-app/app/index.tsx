import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Button } from '../components/Button';
import { useCartStore } from '../store/cart';
import { useGremlin, type GremlinSession } from '../lib/gremlin';

export default function HomeScreen() {
  const router = useRouter();
  const itemCount = useCartStore((state) => state.getItemCount());
  const { isRecording, startRecording, stopRecording, getSession } = useGremlin();
  const [eventCount, setEventCount] = useState(0);

  const handleToggleRecording = () => {
    if (isRecording) {
      const session = stopRecording();
      if (session) {
        const count = session.events?.length || 0;
        Alert.alert(
          'Recording Stopped',
          `Captured ${count} events. Use "Export Session" to save.`
        );
      }
    } else {
      startRecording();
      Alert.alert('Recording Started', 'Interact with the app to capture events.');
    }
  };

  const handleExportSession = async () => {
    const session = getSession();
    if (!session || !session.events?.length) {
      Alert.alert('No Session', 'No recorded session to export. Start recording first.');
      return;
    }

    const sessionJson = JSON.stringify(session, null, 2);
    console.log('=== GREMLIN SESSION ===');
    console.log(sessionJson);
    console.log('=== END SESSION ===');

    try {
      await Share.share({
        message: sessionJson,
        title: `gremlin-session-${session.header?.sessionId || 'unknown'}.json`,
      });
    } catch (error) {
      Alert.alert('Export', 'Session logged to console. Check Metro logs.');
    }
  };

  const handleViewStats = () => {
    const session = getSession();
    if (!session) {
      Alert.alert('No Session', 'No active session.');
      return;
    }

    const events = session.events || [];
    const elements = session.elements || [];
    const eventTypes: Record<string, number> = {};
    events.forEach((e: any) => {
      const type = e.data?.kind || 'unknown';
      eventTypes[type] = (eventTypes[type] || 0) + 1;
    });

    Alert.alert(
      'Session Stats',
      `Events: ${events.length}\n` +
      `Elements: ${elements.length}\n` +
      `Types: ${JSON.stringify(eventTypes, null, 2)}`
    );
  };

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

        <View style={styles.recorderSection}>
          <Text style={styles.sectionTitle}>Gremlin Recorder</Text>
          <View style={styles.recorderStatus}>
            <View style={[styles.statusDot, isRecording && styles.statusDotActive]} />
            <Text style={styles.statusText}>
              {isRecording ? 'Recording...' : 'Not Recording'}
            </Text>
          </View>
          <Button
            title={isRecording ? 'Stop Recording' : 'Start Recording'}
            testID="recorder-toggle-button"
            variant={isRecording ? 'secondary' : 'primary'}
            onPress={handleToggleRecording}
          />
          <View style={styles.recorderActions}>
            <Button
              title="View Stats"
              testID="recorder-stats-button"
              variant="secondary"
              onPress={handleViewStats}
              style={styles.halfButton}
            />
            <Button
              title="Export Session"
              testID="recorder-export-button"
              variant="secondary"
              onPress={handleExportSession}
              style={styles.halfButton}
            />
          </View>
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
  recorderSection: {
    marginTop: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  recorderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8E8E93',
    marginRight: 8,
  },
  statusDotActive: {
    backgroundColor: '#FF3B30',
  },
  statusText: {
    fontSize: 16,
    color: '#3C3C43',
  },
  recorderActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  halfButton: {
    flex: 1,
  },
});
