/**
 * BaseRecorder - Shared recording logic for all platforms
 *
 * Platform recorders extend this class and:
 * 1. Implement abstract methods for platform-specific behavior
 * 2. Wire up platform lifecycle events to flush()
 * 3. Add platform-specific event capture (DOM events, gesture handlers, etc.)
 *
 * Session-level metadata (device, app, user) is stored once in header,
 * not repeated on every event.
 */

import type {
  GremlinSession,
  GremlinEvent,
  ElementInfo,
  TapEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  AppStateEvent,
  ErrorEvent,
  DeviceInfo,
  AppInfo,
} from './types';
import { EventTypeEnum } from './types';
import { EventBatcher, type BatcherConfig } from './batcher';

// ============================================================================
// Types
// ============================================================================

export interface BaseRecorderConfig {
  /** Enable event batching (default: true) */
  enableBatching?: boolean;
  /** Scroll batch window in ms (default: 150) */
  scrollBatchWindow?: number;
  /** Debug logging */
  debug?: boolean;
}

export interface SessionMetadata {
  /** Device information - set once per session */
  device: DeviceInfo;
  /** App information - set once per session */
  app: AppInfo;
  /** Custom session-level metadata */
  custom?: Record<string, unknown>;
}

// ============================================================================
// BaseRecorder
// ============================================================================

export abstract class BaseRecorder {
  protected session: GremlinSession | null = null;
  protected recording: boolean = false;
  protected currentScreen: string = 'unknown';
  protected lastEventTimestamp: number = 0;
  protected elementMap: Map<string, number> = new Map();
  protected config: Required<BaseRecorderConfig>;
  protected batcher: EventBatcher;

  constructor(config: BaseRecorderConfig = {}) {
    this.config = {
      enableBatching: config.enableBatching ?? true,
      scrollBatchWindow: config.scrollBatchWindow ?? 150,
      debug: config.debug ?? false,
    };

    // Initialize batcher with callback to add events
    this.batcher = new EventBatcher(
      {
        scrollBatchWindow: this.config.scrollBatchWindow,
        enabled: this.config.enableBatching,
        debug: this.config.debug,
      },
      {
        onEmit: (event) => this.addEventToSession(event),
      }
    );
  }

  // ========================================================================
  // Abstract methods - Platform recorders must implement
  // ========================================================================

  /** Get device info for session header */
  protected abstract getDeviceInfo(): DeviceInfo;

  /** Get app info for session header */
  protected abstract getAppInfo(): AppInfo;

  /** Generate unique session ID */
  protected generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }

  // ========================================================================
  // Session Lifecycle
  // ========================================================================

  /**
   * Start a new recording session.
   * Session metadata is captured once here.
   */
  start(): void {
    const now = Date.now();

    this.session = {
      header: {
        sessionId: this.generateSessionId(),
        startTime: now,
        device: this.getDeviceInfo(),
        app: this.getAppInfo(),
        schemaVersion: 1,
      },
      elements: [],
      events: [],
      screenshots: [],
    };

    this.recording = true;
    this.lastEventTimestamp = now;
    this.elementMap.clear();

    if (this.config.debug) {
      console.log('[Gremlin] Recording started', {
        sessionId: this.session.header.sessionId,
      });
    }
  }

  /**
   * Stop recording and return the session.
   * Flushes any pending batched events.
   */
  stop(): GremlinSession | null {
    if (!this.session) return null;

    // Flush pending scroll batch before stopping
    this.batcher.flush();

    this.recording = false;
    this.session.header.endTime = Date.now();

    if (this.config.debug) {
      console.log('[Gremlin] Recording stopped', {
        events: this.session.events.length,
        elements: this.session.elements.length,
      });
    }

    return this.getSession();
  }

  /**
   * Flush pending batched events.
   * Call this on lifecycle events (background, visibility hidden).
   */
  flush(): void {
    this.batcher.flush();
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.batcher.destroy();
    this.session = null;
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getSession(): GremlinSession | null {
    if (!this.session) return null;

    return {
      ...this.session,
      header: {
        ...this.session.header,
        endTime: this.session.header.endTime || Date.now(),
      },
    };
  }

  getEventCount(): number {
    return this.session?.events.length ?? 0;
  }

  // ========================================================================
  // Event Recording
  // ========================================================================

  /**
   * Add event to session with delta-encoded timestamp.
   */
  protected addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    if (!this.recording || !this.session) return;

    const now = Date.now();
    const dt = now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    const fullEvent: GremlinEvent = {
      ...event,
      dt,
    };

    this.session.events.push(fullEvent);

    if (this.config.debug) {
      console.log(`[Gremlin] Event: ${EventTypeEnum[event.type]}`, {
        dt,
        data: event.data,
      });
    }
  }

  /**
   * Get or create element in dictionary, return index.
   * Elements are deduplicated by testId/accessibilityLabel/text.
   */
  protected getOrCreateElement(info: Partial<ElementInfo>): number {
    if (!this.session) return -1;

    const key = info.testId || info.accessibilityLabel || info.text || 'unknown';

    if (this.elementMap.has(key)) {
      return this.elementMap.get(key)!;
    }

    const element: ElementInfo = {
      type: info.type || 'unknown',
      ...info,
    };

    const index = this.session.elements.length;
    this.session.elements.push(element);
    this.elementMap.set(key, index);

    return index;
  }

  // ========================================================================
  // Public Recording Methods
  // ========================================================================

  /**
   * Record a tap/click event.
   * All taps are recorded - no deduplication (rapid taps are valuable signal).
   */
  recordTap(x: number, y: number, elementInfo?: Partial<ElementInfo>): void {
    let elementIndex: number | undefined;

    if (elementInfo) {
      elementIndex = this.getOrCreateElement({
        ...elementInfo,
        type: elementInfo.type || 'pressable',
      });
    }

    this.addEventToSession({
      type: EventTypeEnum.TAP,
      data: {
        kind: 'tap',
        x: Math.round(x),
        y: Math.round(y),
        elementIndex,
      } as TapEvent,
    });
  }

  /**
   * Record a scroll event.
   * Scrolls are batched and coalesced to reduce event volume.
   */
  recordScroll(deltaX: number, deltaY: number): void {
    this.batcher.addScroll(deltaX, deltaY);
  }

  /**
   * Record an input event.
   * Sensitive inputs (password, email) are automatically masked.
   */
  recordInput(
    value: string,
    inputType?: 'text' | 'password' | 'email' | 'number' | 'phone',
    elementInfo?: Partial<ElementInfo>
  ): void {
    let elementIndex: number | undefined;

    if (elementInfo) {
      elementIndex = this.getOrCreateElement({
        ...elementInfo,
        type: 'input',
      });
    }

    // Mask sensitive inputs
    const masked = inputType === 'password' || inputType === 'email';

    this.addEventToSession({
      type: EventTypeEnum.INPUT,
      data: {
        kind: 'input',
        elementIndex,
        value: masked ? '[MASKED]' : value,
        masked,
        inputType,
      } as InputEvent,
    });
  }

  /**
   * Record a navigation event.
   */
  recordNavigation(
    screen: string,
    navType: NavigationEvent['navType'] = 'push',
    params?: Record<string, unknown>
  ): void {
    const fromScreen = this.currentScreen;

    this.addEventToSession({
      type: EventTypeEnum.NAVIGATION,
      data: {
        kind: 'navigation',
        navType,
        screen,
        fromScreen,
        params,
      } as NavigationEvent,
    });

    this.currentScreen = screen;
  }

  /**
   * Record an error event.
   */
  recordError(
    message: string,
    errorType: ErrorEvent['errorType'] = 'js',
    stack?: string,
    fatal: boolean = false
  ): void {
    this.addEventToSession({
      type: EventTypeEnum.ERROR,
      data: {
        kind: 'error',
        message,
        stack,
        errorType,
        fatal,
      } as ErrorEvent,
    });
  }

  /**
   * Record an app state change (background/foreground).
   */
  recordAppState(state: AppStateEvent['state']): void {
    // Flush scroll batch when going to background
    if (state === 'background' || state === 'inactive') {
      this.batcher.flush();
    }

    this.addEventToSession({
      type: EventTypeEnum.APP_STATE,
      data: {
        kind: 'app_state',
        state,
      } as AppStateEvent,
    });
  }

  /**
   * Set current screen without recording navigation.
   * Useful for initial screen or when navigation is handled elsewhere.
   */
  setCurrentScreen(screen: string): void {
    this.currentScreen = screen;
  }

  // ========================================================================
  // Analytics Helpers
  // ========================================================================

  /**
   * Get time from session start to reaching a specific screen (ms).
   */
  getTimeToScreen(screenName: string): number | null {
    if (!this.session) return null;

    let elapsed = 0;
    for (const event of this.session.events) {
      elapsed += event.dt;
      if (event.type === EventTypeEnum.NAVIGATION) {
        const navData = event.data as NavigationEvent;
        if (navData.screen === screenName) {
          return elapsed;
        }
      }
    }
    return null;
  }

  /**
   * Get number of taps before reaching a specific screen.
   */
  getTapsToScreen(screenName: string): number {
    if (!this.session) return 0;

    let taps = 0;
    for (const event of this.session.events) {
      if (event.type === EventTypeEnum.TAP) {
        taps++;
      }
      if (event.type === EventTypeEnum.NAVIGATION) {
        const navData = event.data as NavigationEvent;
        if (navData.screen === screenName) {
          return taps;
        }
      }
    }
    return taps;
  }

  /**
   * Get navigation flow (sequence of screens visited).
   */
  getNavigationFlow(): string[] {
    if (!this.session) return [];

    return this.session.events
      .filter((e) => e.type === EventTypeEnum.NAVIGATION)
      .map((e) => (e.data as NavigationEvent).screen);
  }
}
