/**
 * useRecorderActions - Centralized recorder toggle, export, and stats logic.
 *
 * Deduplicates the start/stop, session-export, and stat-computation code
 * that was previously copy-pasted across HomeScreen and RecorderWidget.
 */

import { Alert, Share } from 'react-native';
import { useGremlin } from '../lib/gremlin';

export interface SessionStats {
  eventCount: number;
  elementCount: number;
  eventTypes: Record<string, number>;
  duration: number;
}

export function useRecorderActions() {
  const { isRecording, startRecording, stopRecording, getSession, recorder } =
    useGremlin();

  /**
   * Toggle recording on/off. Shows an alert on state change.
   */
  const toggleRecording = () => {
    if (isRecording) {
      const session = stopRecording();
      if (session) {
        const count = session.events?.length || 0;
        Alert.alert(
          'Recording Stopped',
          `Captured ${count} events. Use "Export" to save.`
        );
      }
    } else {
      startRecording();
      Alert.alert('Recording Started', 'Interact with the app to capture events.');
    }
  };

  /**
   * Serialize the current session to JSON, log it, and open the Share sheet.
   * Guards against empty / missing sessions.
   */
  const exportSession = async () => {
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
    } catch {
      Alert.alert('Export', 'Session logged to console. Check Metro logs.');
    }
  };

  /**
   * Compute summary statistics for the current session.
   * Returns null when no session data is available.
   */
  const getStats = (): SessionStats | null => {
    const session = getSession();
    if (!session) return null;

    const events = session.events || [];
    const elements = session.elements || [];
    const eventTypes: Record<string, number> = {};
    events.forEach((e: any) => {
      const type = e.data?.kind || e.type || 'unknown';
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

  return {
    isRecording,
    recorder,
    toggleRecording,
    exportSession,
    getStats,
    getSession,
  };
}
