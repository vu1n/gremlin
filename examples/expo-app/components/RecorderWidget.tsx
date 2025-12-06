import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Share,
  Modal,
  ScrollView,
} from 'react-native';
import { useGremlin } from '../lib/gremlin';

export function RecorderWidget() {
  const { isRecording, startRecording, stopRecording, getSession, getEventCount } = useGremlin();
  const [expanded, setExpanded] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const handleToggleRecording = () => {
    if (isRecording) {
      const session = stopRecording();
      if (session) {
        const count = session.events?.length || 0;
        Alert.alert(
          'Recording Stopped',
          `Captured ${count} events. Tap "Export" to save.`
        );
      }
    } else {
      startRecording();
    }
  };

  const handleExportSession = async () => {
    const session = getSession();
    if (!session || !session.events?.length) {
      Alert.alert('No Session', 'No recorded session to export.');
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
      Alert.alert('Exported', 'Session logged to console. Check Metro logs.');
    }
  };

  const handleViewStats = () => {
    setShowStats(true);
  };

  const getStats = () => {
    const session = getSession();
    if (!session) return null;

    const events = session.events || [];
    const elements = session.elements || [];
    const eventTypes: Record<string, number> = {};
    events.forEach((e) => {
      const type = e.type || 'unknown';
      eventTypes[type] = (eventTypes[type] || 0) + 1;
    });

    return {
      eventCount: events.length,
      elementCount: elements.length,
      eventTypes,
      duration: session.header?.endTime
        ? Math.round((Date.now() - session.header.startTime) / 1000)
        : 0,
    };
  };

  const eventCount = getEventCount();

  if (!expanded) {
    // Collapsed: just show a small floating button
    return (
      <Pressable
        style={[styles.fab, isRecording && styles.fabRecording]}
        onPress={() => setExpanded(true)}
        testID="recorder-fab"
      >
        <Text style={styles.fabText}>
          {isRecording ? `${eventCount}` : 'REC'}
        </Text>
        {isRecording && <View style={styles.recordingDot} />}
      </Pressable>
    );
  }

  const stats = getStats();

  return (
    <>
      <View style={styles.expandedContainer}>
        <View style={styles.header}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, isRecording && styles.statusDotActive]} />
            <Text style={styles.statusText}>
              {isRecording ? `Recording (${eventCount})` : 'Stopped'}
            </Text>
          </View>
          <Pressable onPress={() => setExpanded(false)} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>X</Text>
          </Pressable>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, isRecording ? styles.stopButton : styles.startButton]}
            onPress={handleToggleRecording}
          >
            <Text style={styles.buttonText}>
              {isRecording ? 'Stop' : 'Start'}
            </Text>
          </Pressable>

          <Pressable style={styles.button} onPress={handleViewStats}>
            <Text style={styles.buttonText}>Stats</Text>
          </Pressable>

          <Pressable style={styles.button} onPress={handleExportSession}>
            <Text style={styles.buttonText}>Export</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={showStats}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStats(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Session Stats</Text>
            {stats ? (
              <ScrollView style={styles.statsContainer}>
                <Text style={styles.statItem}>Events: {stats.eventCount}</Text>
                <Text style={styles.statItem}>Elements: {stats.elementCount}</Text>
                <Text style={styles.statItem}>Duration: {stats.duration}s</Text>
                <Text style={styles.statLabel}>Event Types:</Text>
                {Object.entries(stats.eventTypes).map(([type, count]) => (
                  <Text key={type} style={styles.statSubItem}>
                    {type}: {count}
                  </Text>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.noStats}>No session data</Text>
            )}
            <Pressable
              style={styles.modalCloseButton}
              onPress={() => setShowStats(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8E8E93',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 1000,
  },
  fabRecording: {
    backgroundColor: '#FF3B30',
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  recordingDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  expandedContainer: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    left: 20,
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#8E8E93',
    marginRight: 8,
  },
  statusDotActive: {
    backgroundColor: '#FF3B30',
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    color: '#8E8E93',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    backgroundColor: '#3A3A3C',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#34C759',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 20,
    width: '80%',
    maxHeight: '60%',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  statsContainer: {
    marginBottom: 16,
  },
  statItem: {
    color: '#FFFFFF',
    fontSize: 16,
    marginBottom: 8,
  },
  statLabel: {
    color: '#8E8E93',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  statSubItem: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 12,
    marginBottom: 4,
  },
  noStats: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 20,
  },
  modalCloseButton: {
    backgroundColor: '#3A3A3C',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
