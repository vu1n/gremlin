/**
 * Gremlin Session Recorder - React Native Integration
 *
 * This is a placeholder implementation for the Gremlin session recorder.
 * The actual SDK will be implemented separately and will replace this mock.
 *
 * The recorder captures user interactions (taps, scrolls, text input) and
 * screen changes to enable session replay and debugging.
 */

export interface GremlinEvent {
  type: 'tap' | 'scroll' | 'input' | 'navigation';
  timestamp: number;
  testID?: string;
  screen: string;
  data?: Record<string, any>;
}

export class GremlinRecorder {
  private events: GremlinEvent[] = [];
  private isRecording: boolean = false;
  private currentScreen: string = 'unknown';

  constructor(private config: { apiKey?: string; debug?: boolean } = {}) {
    if (this.config.debug) {
      console.log('[Gremlin] Recorder initialized');
    }
  }

  /**
   * Start recording user sessions
   */
  start() {
    this.isRecording = true;
    this.events = [];
    if (this.config.debug) {
      console.log('[Gremlin] Recording started');
    }
  }

  /**
   * Stop recording and optionally upload session
   */
  stop() {
    this.isRecording = false;
    if (this.config.debug) {
      console.log('[Gremlin] Recording stopped');
      console.log(`[Gremlin] Captured ${this.events.length} events`);
    }
  }

  /**
   * Set the current screen name for context
   */
  setScreen(screen: string) {
    this.currentScreen = screen;
    if (this.config.debug) {
      console.log(`[Gremlin] Screen changed: ${screen}`);
    }
  }

  /**
   * Record a tap/press event
   */
  recordTap(testID?: string, data?: Record<string, any>) {
    if (!this.isRecording) return;

    const event: GremlinEvent = {
      type: 'tap',
      timestamp: Date.now(),
      testID,
      screen: this.currentScreen,
      data,
    };

    this.events.push(event);

    if (this.config.debug) {
      console.log('[Gremlin] Tap recorded:', {
        testID,
        screen: this.currentScreen,
        data,
      });
    }
  }

  /**
   * Record a scroll event
   */
  recordScroll(data?: Record<string, any>) {
    if (!this.isRecording) return;

    const event: GremlinEvent = {
      type: 'scroll',
      timestamp: Date.now(),
      screen: this.currentScreen,
      data,
    };

    this.events.push(event);

    if (this.config.debug) {
      console.log('[Gremlin] Scroll recorded:', {
        screen: this.currentScreen,
        data,
      });
    }
  }

  /**
   * Record a text input event
   */
  recordInput(testID?: string, value?: string) {
    if (!this.isRecording) return;

    const event: GremlinEvent = {
      type: 'input',
      timestamp: Date.now(),
      testID,
      screen: this.currentScreen,
      data: { value: value ? '***' : undefined }, // Mask actual input for privacy
    };

    this.events.push(event);

    if (this.config.debug) {
      console.log('[Gremlin] Input recorded:', {
        testID,
        screen: this.currentScreen,
      });
    }
  }

  /**
   * Record a navigation event
   */
  recordNavigation(from: string, to: string) {
    if (!this.isRecording) return;

    const event: GremlinEvent = {
      type: 'navigation',
      timestamp: Date.now(),
      screen: to,
      data: { from, to },
    };

    this.events.push(event);
    this.currentScreen = to;

    if (this.config.debug) {
      console.log('[Gremlin] Navigation recorded:', { from, to });
    }
  }

  /**
   * Get all recorded events
   */
  getEvents(): GremlinEvent[] {
    return [...this.events];
  }

  /**
   * Export session as JSON
   */
  exportSession() {
    return {
      events: this.events,
      sessionId: `session-${Date.now()}`,
      startTime: this.events[0]?.timestamp,
      endTime: this.events[this.events.length - 1]?.timestamp,
      duration: this.events.length > 0
        ? this.events[this.events.length - 1].timestamp - this.events[0].timestamp
        : 0,
    };
  }
}

// Singleton instance
let gremlinInstance: GremlinRecorder | null = null;

/**
 * Initialize Gremlin recorder
 */
export function initGremlin(config?: { apiKey?: string; debug?: boolean }) {
  if (!gremlinInstance) {
    gremlinInstance = new GremlinRecorder(config);
    gremlinInstance.start();
  }
  return gremlinInstance;
}

/**
 * Get the Gremlin recorder instance
 */
export function getGremlin(): GremlinRecorder {
  if (!gremlinInstance) {
    throw new Error('Gremlin not initialized. Call initGremlin() first.');
  }
  return gremlinInstance;
}
