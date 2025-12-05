/**
 * Gremlin Demo Shop - Recorder Integration
 * Integrates the @gremlin/recorder-web SDK to capture user sessions
 */

import { GremlinRecorder } from '@gremlin/recorder-web';

// ============================================================================
// Recorder Setup
// ============================================================================

let recorder = null;
let eventCount = 0;
let lastSession = null; // Store session after stop for export

function initRecorder() {
  recorder = new GremlinRecorder({
    appName: 'Gremlin Demo Shop',
    appVersion: '1.0.0',
    appBuild: '001',
    autoStart: false,
    capturePerformance: true,
    performanceInterval: 5000,
    maskInputs: true, // Mask sensitive inputs like passwords/emails
    persistSession: true, // Enable multi-page persistence
    onEvent: (event) => {
      // Update event count in real-time
      eventCount++;
      updateEventCount();
    },
  });

  console.log('Gremlin recorder initialized');
}

/**
 * Try to resume a recording session from the previous page.
 * Returns true if a session was resumed.
 */
function tryResumeRecording() {
  if (!recorder) {
    initRecorder();
  }

  if (recorder.hasPersistentSession()) {
    const resumed = recorder.resume();
    if (resumed) {
      // Update event count from resumed session
      const session = recorder.getSession();
      if (session) {
        eventCount = session.events.length;
      }
      return true;
    }
  }
  return false;
}

// ============================================================================
// UI Controls
// ============================================================================

function setupRecorderControls() {
  const startBtn = document.getElementById('start-recording');
  const stopBtn = document.getElementById('stop-recording');
  const exportBtn = document.getElementById('export-session');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  // Helper to update UI for recording state
  function setRecordingUI(isRecording, eventCountVal) {
    if (startBtn) startBtn.disabled = isRecording;
    if (stopBtn) stopBtn.disabled = !isRecording;
    if (exportBtn) exportBtn.disabled = isRecording;
    if (statusIndicator) {
      statusIndicator.className = isRecording ? 'status-indicator recording' : 'status-indicator stopped';
    }
    if (statusText) {
      statusText.textContent = isRecording ? 'Recording' : 'Stopped';
    }
    eventCount = eventCountVal;
    updateEventCount();
  }

  // Try to resume recording from previous page
  const resumed = tryResumeRecording();
  if (resumed) {
    const session = recorder.getSession();
    setRecordingUI(true, session?.events.length || 0);
    console.log(`Recording resumed from previous page (${eventCount} events)`);
    showNotification(`Recording resumed! ${eventCount} events captured so far.`, 'info');
  }

  // Start recording
  startBtn?.addEventListener('click', () => {
    if (!recorder) {
      initRecorder();
    }

    recorder.start();
    lastSession = null; // Clear previous session
    setRecordingUI(true, 0);

    console.log('Recording started');

    // Show notification
    showNotification('Recording started! Interact with the app to capture events.', 'success');
  });

  // Stop recording
  stopBtn?.addEventListener('click', () => {
    const session = recorder.stop();

    // Clear persisted session after stopping
    recorder.clearStorage();

    if (session) {
      // Store session for export
      lastSession = session;

      // Update UI
      setRecordingUI(false, session.events.length);

      console.log('Recording stopped:', {
        sessionId: session.header.sessionId,
        events: session.events.length,
        elements: session.elements.length,
        duration: session.header.endTime - session.header.startTime
      });

      // Show notification
      showNotification(
        `Recording stopped! Captured ${session.events.length} events from ${session.elements.length} elements.`,
        'success'
      );
    }
  });

  // Export session
  exportBtn?.addEventListener('click', () => {
    // Get active session or last stopped session
    const session = recorder.getSession() || lastSession;

    if (!session) {
      showNotification('No session to export. Start recording first!', 'error');
      return;
    }

    const json = JSON.stringify(session, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create download link
    const a = document.createElement('a');
    a.href = url;
    a.download = `gremlin-session-${session.header.sessionId}.json`;
    a.click();

    URL.revokeObjectURL(url);

    console.log('Session exported');
    showNotification('Session exported! Check your downloads.', 'success');

    // Also log a preview to console
    console.log('Session Preview:', {
      sessionId: session.header.sessionId,
      platform: session.header.device.platform,
      appName: session.header.app.name,
      startTime: new Date(session.header.startTime).toISOString(),
      endTime: session.header.endTime ? new Date(session.header.endTime).toISOString() : 'N/A',
      eventCount: session.events.length,
      elementCount: session.elements.length,
      sampleEvents: session.events.slice(0, 3),
      sampleElements: session.elements.slice(0, 3)
    });
  });
}

function updateEventCount() {
  const eventCountEl = document.getElementById('event-count');
  if (eventCountEl) {
    eventCountEl.textContent = `${eventCount} event${eventCount === 1 ? '' : 's'}`;
  }
}

// ============================================================================
// Notifications
// ============================================================================

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => notification.classList.add('show'), 10);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ============================================================================
// Session Analysis
// ============================================================================

function analyzeSession(session) {
  if (!session) return null;

  const analysis = {
    sessionId: session.header.sessionId,
    duration: session.header.endTime - session.header.startTime,
    eventCount: session.events.length,
    elementCount: session.elements.length,
    eventTypes: {},
    elementsWithTestIds: 0,
    uniqueScreens: new Set(),
  };

  // Analyze events
  session.events.forEach(event => {
    const typeName = getEventTypeName(event.type);
    analysis.eventTypes[typeName] = (analysis.eventTypes[typeName] || 0) + 1;

    if (event.data.kind === 'navigation') {
      analysis.uniqueScreens.add(event.data.screen || event.data.url);
    }
  });

  // Analyze elements
  session.elements.forEach(element => {
    if (element.testId) {
      analysis.elementsWithTestIds++;
    }
  });

  return {
    ...analysis,
    uniqueScreens: analysis.uniqueScreens.size,
    testIdCoverage: `${Math.round((analysis.elementsWithTestIds / analysis.elementCount) * 100)}%`
  };
}

function getEventTypeName(type) {
  const types = {
    0: 'TAP',
    1: 'SWIPE',
    2: 'PINCH',
    3: 'LONG_PRESS',
    4: 'SCROLL',
    5: 'INPUT',
    6: 'NAVIGATION',
    7: 'LIFECYCLE',
    8: 'ASSERTION',
    9: 'ERROR',
    10: 'CUSTOM'
  };
  return types[type] || 'UNKNOWN';
}

// ============================================================================
// Debug Panel (Console Commands)
// ============================================================================

// Expose utilities for debugging in console
window.gremlinDebug = {
  recorder,
  getSession: () => recorder?.getSession(),
  analyze: () => {
    const session = recorder?.getSession();
    if (!session) {
      console.log('No active session');
      return null;
    }
    const analysis = analyzeSession(session);
    console.table(analysis);
    return analysis;
  },
  exportConsole: () => {
    const session = recorder?.getSession();
    if (session) {
      console.log(JSON.stringify(session, null, 2));
    }
  },
  getEvents: (type) => {
    const session = recorder?.getSession();
    if (!session) return [];

    if (type === undefined) return session.events;

    const typeMap = {
      'tap': 0,
      'swipe': 1,
      'pinch': 2,
      'longpress': 3,
      'scroll': 4,
      'input': 5,
      'navigation': 6,
      'lifecycle': 7,
      'assertion': 8,
      'error': 9,
      'custom': 10
    };

    const typeNum = typeof type === 'string' ? typeMap[type.toLowerCase()] : type;
    return session.events.filter(e => e.type === typeNum);
  },
  getElements: () => {
    const session = recorder?.getSession();
    return session?.elements || [];
  },
  getElementsWithTestIds: () => {
    const session = recorder?.getSession();
    if (!session) return [];
    return session.elements.filter(e => e.testId);
  }
};

console.log(`
╔═══════════════════════════════════════════╗
║  Gremlin Recorder Debug Commands          ║
╚═══════════════════════════════════════════╝

Usage in console:

  gremlinDebug.getSession()          - Get current session
  gremlinDebug.analyze()             - Analyze session stats
  gremlinDebug.exportConsole()       - Export session to console
  gremlinDebug.getEvents('tap')      - Get events by type
  gremlinDebug.getElements()         - Get all captured elements
  gremlinDebug.getElementsWithTestIds() - Get elements with test IDs

Example:
  gremlinDebug.analyze()
  > {
      sessionId: "abc123",
      duration: 45230,
      eventCount: 23,
      eventTypes: { TAP: 15, INPUT: 5, NAVIGATION: 3 },
      elementsWithTestIds: 18,
      testIdCoverage: "95%"
    }
`);

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupRecorderControls();

  // Add keyboard shortcut: Ctrl+Shift+R to start/stop recording
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'R') {
      e.preventDefault();

      if (!recorder) {
        initRecorder();
      }

      if (recorder.isActive()) {
        document.getElementById('stop-recording')?.click();
      } else {
        document.getElementById('start-recording')?.click();
      }
    }
  });

  console.log('Gremlin recorder controls initialized');
  console.log('Keyboard shortcut: Ctrl+Shift+R to start/stop recording');
});
