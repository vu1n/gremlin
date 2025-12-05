/**
 * GremlinRecorder - Web session recorder
 *
 * Wraps rrweb for DOM recording and enriches events with element identification.
 * Captures clicks, inputs, scrolls, and navigation with test IDs and accessibility info.
 */

import { record, type recordOptions, type eventWithTime } from 'rrweb';
import type {
  GremlinSession,
  GremlinEvent,
  EventTypeEnum,
  TapEvent,
  InputEvent,
  ScrollEvent,
  NavigationEvent,
  ErrorEvent,
  DeviceInfo,
  AppInfo,
  PerformanceSample,
} from '@gremlin/core';
import {
  createSession,
  getOrCreateElement,
  addEvent,
} from '@gremlin/core';
import { captureElement, findInteractiveElement } from './element-capture';

export interface RecorderConfig {
  /** App name */
  appName: string;

  /** App version */
  appVersion: string;

  /** Build number */
  appBuild?: string;

  /** Auto-start recording on page load */
  autoStart?: boolean;

  /** Sample performance metrics */
  capturePerformance?: boolean;

  /** Performance sample interval (ms) */
  performanceInterval?: number;

  /** Mask sensitive inputs */
  maskInputs?: boolean;

  /** Emit events to callback (for real-time streaming) */
  onEvent?: (event: GremlinEvent) => void;

  /** Custom rrweb options */
  rrwebOptions?: Partial<recordOptions<eventWithTime>>;

  /** Persist session to sessionStorage for multi-page apps */
  persistSession?: boolean;

  /** Storage key for session persistence */
  storageKey?: string;

  /** Enable event batching for scroll/tap optimization */
  enableBatching?: boolean;

  /** Scroll batching window (ms) - coalesce scrolls within this window */
  scrollBatchWindow?: number;

}

// Batching state types
interface ScrollBatch {
  totalDeltaX: number;
  totalDeltaY: number;
  containerIndex?: number;
  startTime: number;
  lastTime: number;
  eventCount: number;
}


export class GremlinRecorder {
  private static readonly DEFAULT_STORAGE_KEY = 'gremlin_session';

  private config: RecorderConfig & {
    autoStart: boolean;
    capturePerformance: boolean;
    performanceInterval: number;
    maskInputs: boolean;
    persistSession: boolean;
    storageKey: string;
    enableBatching: boolean;
    scrollBatchWindow: number;
    rrwebOptions: Partial<recordOptions<eventWithTime>>;
  };
  private session: GremlinSession | null = null;
  private isRecording = false;
  private stopRrweb: (() => void) | null = null;
  private lastEventTimestamp = 0;
  private performanceTimer: number | null = null;
  private navigationStartTime = 0;

  // Batching state (scroll only - taps are NOT batched, they're valuable signal)
  private scrollBatch: ScrollBatch | null = null;
  private scrollFlushTimer: number | null = null;

  constructor(config: RecorderConfig) {
    this.config = {
      appName: config.appName,
      appVersion: config.appVersion,
      appBuild: config.appBuild,
      autoStart: config.autoStart ?? false,
      capturePerformance: config.capturePerformance ?? true,
      performanceInterval: config.performanceInterval ?? 5000,
      maskInputs: config.maskInputs ?? true,
      persistSession: config.persistSession ?? false,
      storageKey: config.storageKey ?? GremlinRecorder.DEFAULT_STORAGE_KEY,
      enableBatching: config.enableBatching ?? true, // Enabled by default
      scrollBatchWindow: config.scrollBatchWindow ?? 150, // 150ms window
      onEvent: config.onEvent,
      rrwebOptions: config.rrwebOptions ?? {},
    };

    if (this.config.autoStart) {
      // Auto-start after page load
      if (document.readyState === 'complete') {
        this.start();
      } else {
        window.addEventListener('load', () => this.start());
      }
    }

    // Setup persistence handlers for multi-page apps
    if (this.config.persistSession) {
      this.setupPersistence();
    }
  }

  /**
   * Start recording session.
   */
  public start(): void {
    if (this.isRecording) {
      console.warn('GremlinRecorder: Already recording');
      return;
    }

    // Create session
    this.session = createSession(this.getDeviceInfo(), this.getAppInfo());
    this.lastEventTimestamp = this.session.header.startTime;
    this.navigationStartTime = this.lastEventTimestamp;
    this.isRecording = true;

    // Setup event listeners
    this.setupEventListeners();

    // Start rrweb recording
    this.startRrwebRecording();

    // Start performance sampling
    if (this.config.capturePerformance) {
      this.startPerformanceSampling();
    }

    console.log(`GremlinRecorder: Started session ${this.session.header.sessionId}`);
  }

  /**
   * Stop recording and return session.
   */
  public stop(): GremlinSession | null {
    if (!this.isRecording || !this.session) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    this.isRecording = false;

    // Flush any pending scroll batch before stopping
    this.flushScrollBatch();

    // Clear scroll timer
    if (this.scrollFlushTimer !== null) {
      clearTimeout(this.scrollFlushTimer);
      this.scrollFlushTimer = null;
    }

    // Stop rrweb
    if (this.stopRrweb) {
      this.stopRrweb();
      this.stopRrweb = null;
    }

    // Stop performance sampling
    if (this.performanceTimer !== null) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }

    // Remove event listeners
    this.removeEventListeners();

    // Set end time
    this.session.header.endTime = Date.now();

    const finalSession = this.session;
    this.session = null;

    console.log(
      `GremlinRecorder: Stopped session ${finalSession.header.sessionId} - ` +
        `${finalSession.events.length} events, ${finalSession.elements.length} elements`
    );

    return finalSession;
  }

  /**
   * Get current session (without stopping).
   */
  public getSession(): GremlinSession | null {
    return this.session;
  }

  /**
   * Check if currently recording.
   */
  public isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Export session as JSON.
   */
  public exportJson(): string | null {
    if (!this.session) return null;
    return JSON.stringify(this.session, null, 2);
  }

  // ========================================================================
  // Private Methods - Session Setup
  // ========================================================================

  private getDeviceInfo(): DeviceInfo {
    return {
      platform: 'web',
      osVersion: this.getOSVersion(),
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        pixelRatio: window.devicePixelRatio || 1,
      },
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };
  }

  private getAppInfo(): AppInfo {
    return {
      name: this.config.appName,
      version: this.config.appVersion,
      build: this.config.appBuild,
      identifier: window.location.origin,
    };
  }

  private getOSVersion(): string {
    const ua = navigator.userAgent;

    if (ua.includes('Windows NT 10.0')) return 'Windows 10';
    if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
    if (ua.includes('Windows NT 6.2')) return 'Windows 8';
    if (ua.includes('Windows NT 6.1')) return 'Windows 7';
    if (ua.includes('Mac OS X')) {
      const match = ua.match(/Mac OS X (\d+[._]\d+[._]\d+)/);
      return match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS';
    }
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('iPhone') || ua.includes('iPad')) {
      const match = ua.match(/OS (\d+_\d+)/);
      return match ? `iOS ${match[1].replace(/_/g, '.')}` : 'iOS';
    }
    if (ua.includes('Android')) {
      const match = ua.match(/Android (\d+\.?\d*)/);
      return match ? `Android ${match[1]}` : 'Android';
    }

    return 'Unknown';
  }

  // ========================================================================
  // Private Methods - rrweb Integration
  // ========================================================================

  private startRrwebRecording(): void {
    const stopFn = record({
      emit: (event) => {
        // rrweb events are stored separately, not in our event stream
        // We use rrweb for full DOM replay capability
        // Our event stream focuses on user interactions for test generation
      },
      sampling: {
        // Sample scrolls to reduce noise
        scroll: 150,
        // Sample mouse moves
        mousemove: false,
        // Capture media interactions
        media: 800,
        // Sample input changes
        input: 'last',
      },
      recordCanvas: false, // Disable canvas recording for performance
      collectFonts: false, // Disable font collection
      ...this.config.rrwebOptions,
    });

    if (stopFn) {
      this.stopRrweb = stopFn;
    }
  }

  // ========================================================================
  // Private Methods - Event Listeners
  // ========================================================================

  private setupEventListeners(): void {
    // Click events
    document.addEventListener('click', this.handleClick as EventListener, true);

    // Input events
    document.addEventListener('input', this.handleInput as EventListener, true);
    document.addEventListener('change', this.handleChange as EventListener, true);

    // Scroll events
    document.addEventListener('scroll', this.handleScroll as EventListener, true);

    // Navigation events
    window.addEventListener('popstate', this.handleNavigation as EventListener);

    // Error events
    window.addEventListener('error', this.handleError as EventListener);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection as EventListener);

    // Page visibility
    document.addEventListener('visibilitychange', this.handleVisibilityChange as EventListener);

    // Intercept pushState/replaceState for SPA navigation
    this.interceptHistoryApi();
  }

  private removeEventListeners(): void {
    document.removeEventListener('click', this.handleClick as EventListener, true);
    document.removeEventListener('input', this.handleInput as EventListener, true);
    document.removeEventListener('change', this.handleChange as EventListener, true);
    document.removeEventListener('scroll', this.handleScroll as EventListener, true);
    window.removeEventListener('popstate', this.handleNavigation as EventListener);
    window.removeEventListener('error', this.handleError as EventListener);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection as EventListener);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange as EventListener);
  }

  // ========================================================================
  // Private Methods - Event Handlers
  // ========================================================================

  private handleClick = (event: MouseEvent): void => {
    if (!this.session) return;

    // Find interactive element
    const interactiveElement = findInteractiveElement(event.target);
    const targetElement = interactiveElement || (event.target as HTMLElement);

    // Capture element info
    let elementIndex: number | undefined;
    if (targetElement instanceof HTMLElement) {
      const elementInfo = captureElement(targetElement);
      elementIndex = getOrCreateElement(this.session, elementInfo);
    }

    const x = Math.round(event.clientX);
    const y = Math.round(event.clientY);

    // Record ALL taps - rapid taps are valuable signal (frustration, lag, etc.)
    const tapEvent: Omit<GremlinEvent, 'dt'> = {
      type: 0 as EventTypeEnum.TAP, // TAP = 0
      data: {
        kind: 'tap',
        x,
        y,
        elementIndex,
      } as TapEvent,
      perf: this.config.capturePerformance ? this.capturePerformance() : undefined,
    };

    this.addEventToSession(tapEvent);
  };

  private handleInput = (event: Event): void => {
    if (!this.session) return;

    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    // Capture element info
    const elementInfo = captureElement(target);
    const elementIndex = getOrCreateElement(this.session, elementInfo);

    // Determine input type
    let inputType: InputEvent['inputType'] = 'text';
    if (target instanceof HTMLInputElement) {
      switch (target.type) {
        case 'password':
          inputType = 'password';
          break;
        case 'email':
          inputType = 'email';
          break;
        case 'tel':
          inputType = 'phone';
          break;
        case 'number':
          inputType = 'number';
          break;
      }
    }

    // Mask sensitive inputs
    const shouldMask = this.config.maskInputs && (inputType === 'password' || inputType === 'email');
    const value = shouldMask ? '***' : target.value;

    const inputEvent: Omit<GremlinEvent, 'dt'> = {
      type: 5 as EventTypeEnum.INPUT, // INPUT = 5
      data: {
        kind: 'input',
        elementIndex,
        value,
        masked: shouldMask,
        inputType,
      } as InputEvent,
    };

    this.addEventToSession(inputEvent);
  };

  private handleChange = (event: Event): void => {
    // For select elements and other change events
    if (!this.session) return;

    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    const elementInfo = captureElement(target);
    const elementIndex = getOrCreateElement(this.session, elementInfo);

    const inputEvent: Omit<GremlinEvent, 'dt'> = {
      type: 5 as EventTypeEnum.INPUT,
      data: {
        kind: 'input',
        elementIndex,
        value: target.value,
        masked: false,
        inputType: 'text',
      } as InputEvent,
    };

    this.addEventToSession(inputEvent);
  };

  private handleScroll = (event: Event): void => {
    if (!this.session) return;

    const target = event.target;
    const now = Date.now();

    // Get scroll position (absolute, not delta)
    let scrollX = 0;
    let scrollY = 0;

    if (target === document || target === document.documentElement) {
      scrollY = window.scrollY;
      scrollX = window.scrollX;
    } else if (target instanceof HTMLElement) {
      scrollY = target.scrollTop;
      scrollX = target.scrollLeft;
    }

    // If batching disabled, record immediately
    if (!this.config.enableBatching) {
      this.recordScrollEvent(scrollX, scrollY);
      return;
    }

    // Batching: accumulate scroll events and flush after window expires
    if (this.scrollBatch) {
      // Update existing batch
      this.scrollBatch.totalDeltaX = scrollX;
      this.scrollBatch.totalDeltaY = scrollY;
      this.scrollBatch.lastTime = now;
      this.scrollBatch.eventCount++;
    } else {
      // Start new batch
      this.scrollBatch = {
        totalDeltaX: scrollX,
        totalDeltaY: scrollY,
        startTime: now,
        lastTime: now,
        eventCount: 1,
      };
    }

    // Reset flush timer
    if (this.scrollFlushTimer !== null) {
      clearTimeout(this.scrollFlushTimer);
    }

    // Schedule flush after batch window
    this.scrollFlushTimer = window.setTimeout(() => {
      this.flushScrollBatch();
    }, this.config.scrollBatchWindow);
  };

  private flushScrollBatch(): void {
    if (!this.scrollBatch || !this.session) {
      this.scrollBatch = null;
      this.scrollFlushTimer = null;
      return;
    }

    const batch = this.scrollBatch;
    this.scrollBatch = null;
    this.scrollFlushTimer = null;

    // Record single coalesced scroll event
    this.recordScrollEvent(batch.totalDeltaX, batch.totalDeltaY, batch.eventCount);
  }

  private recordScrollEvent(deltaX: number, deltaY: number, coalescedCount?: number): void {
    if (!this.session) return;

    const scrollEvent: Omit<GremlinEvent, 'dt'> = {
      type: 4 as EventTypeEnum.SCROLL, // SCROLL = 4
      data: {
        kind: 'scroll',
        deltaX: Math.round(deltaX),
        deltaY: Math.round(deltaY),
        // Store coalesced count in the event for replay optimization hints
        ...(coalescedCount && coalescedCount > 1 ? { coalesced: coalescedCount } : {}),
      } as ScrollEvent,
    };

    this.addEventToSession(scrollEvent);
  }

  private handleNavigation = (): void => {
    if (!this.session) return;

    this.navigationStartTime = Date.now();

    const navigationEvent: Omit<GremlinEvent, 'dt'> = {
      type: 6 as EventTypeEnum.NAVIGATION, // NAVIGATION = 6
      data: {
        kind: 'navigation',
        navType: 'push',
        screen: document.title,
        url: window.location.href,
      } as NavigationEvent,
    };

    this.addEventToSession(navigationEvent);
  };

  private handleError = (event: Event): void => {
    if (!this.session) return;

    const errorEvent = event as unknown as ErrorEvent;
    const error = (errorEvent as any).error;

    const gremlinError: Omit<GremlinEvent, 'dt'> = {
      type: 9 as EventTypeEnum.ERROR, // ERROR = 9
      data: {
        kind: 'error',
        message: errorEvent.message || 'Unknown error',
        stack: error?.stack,
        errorType: 'js',
        fatal: false,
      } as ErrorEvent,
    };

    this.addEventToSession(gremlinError);
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (!this.session) return;

    const errorEvent: Omit<GremlinEvent, 'dt'> = {
      type: 9 as EventTypeEnum.ERROR,
      data: {
        kind: 'error',
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        errorType: 'js',
        fatal: false,
      } as ErrorEvent,
    };

    this.addEventToSession(errorEvent);
  };

  private handleVisibilityChange = (): void => {
    if (!this.session) return;

    // Flush scroll batch when page goes to background (prevents data loss on abrupt exit)
    if (document.visibilityState === 'hidden') {
      this.flushScrollBatch();
    }
  };

  // ========================================================================
  // Private Methods - History API Interception
  // ========================================================================

  private interceptHistoryApi(): void {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.handleNavigation();
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.handleNavigation();
    };
  }

  // ========================================================================
  // Private Methods - Performance Capture
  // ========================================================================

  private startPerformanceSampling(): void {
    this.performanceTimer = window.setInterval(() => {
      // Performance sampling happens during other events
      // This is just to ensure we get regular samples
    }, this.config.performanceInterval);
  }

  private capturePerformance(): PerformanceSample | undefined {
    try {
      const perf: PerformanceSample = {};

      // Memory usage
      if ('memory' in performance && (performance as any).memory) {
        const memory = (performance as any).memory;
        perf.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024); // MB
      }

      // Time since navigation
      if (this.navigationStartTime > 0) {
        perf.timeSinceNavigation = Date.now() - this.navigationStartTime;
      }

      // FPS estimation (simplified)
      // For accurate FPS, would need requestAnimationFrame tracking

      return perf;
    } catch {
      return undefined;
    }
  }

  // ========================================================================
  // Private Methods - Event Management
  // ========================================================================

  private addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    if (!this.session) return;

    this.lastEventTimestamp = addEvent(this.session, event, this.lastEventTimestamp);

    // Emit to callback if configured
    if (this.config.onEvent) {
      const fullEvent = this.session.events[this.session.events.length - 1];
      this.config.onEvent(fullEvent);
    }

    // Persist to storage if enabled
    if (this.config.persistSession) {
      this.saveToStorage();
    }
  }

  // ========================================================================
  // Private Methods - Session Persistence (Multi-page Apps)
  // ========================================================================

  private setupPersistence(): void {
    // Save session before page unload
    window.addEventListener('beforeunload', () => {
      if (this.isRecording && this.session) {
        // Flush any pending scroll batch before saving
        this.flushScrollBatch();
        this.saveToStorage();
      }
    });

    // Also save on visibility change (mobile tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.isRecording && this.session) {
        // Flush scroll batch before saving (handled in handleVisibilityChange too, but belt & suspenders)
        this.flushScrollBatch();
        this.saveToStorage();
      }
    });
  }

  private saveToStorage(): void {
    if (!this.session) return;

    try {
      const state = {
        session: this.session,
        lastEventTimestamp: this.lastEventTimestamp,
        navigationStartTime: this.navigationStartTime,
        isRecording: this.isRecording,
      };
      sessionStorage.setItem(this.config.storageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('GremlinRecorder: Failed to save session to storage', e);
    }
  }

  private loadFromStorage(): boolean {
    try {
      const stored = sessionStorage.getItem(this.config.storageKey);
      if (!stored) return false;

      const state = JSON.parse(stored);
      if (!state.session || !state.isRecording) return false;

      this.session = state.session;
      this.lastEventTimestamp = state.lastEventTimestamp || Date.now();
      this.navigationStartTime = state.navigationStartTime || Date.now();
      this.isRecording = true;

      return true;
    } catch (e) {
      console.warn('GremlinRecorder: Failed to load session from storage', e);
      return false;
    }
  }

  /**
   * Clear persisted session from storage.
   */
  public clearStorage(): void {
    try {
      sessionStorage.removeItem(this.config.storageKey);
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Check if there's a persisted session that can be resumed.
   */
  public hasPersistentSession(): boolean {
    try {
      const stored = sessionStorage.getItem(this.config.storageKey);
      if (!stored) return false;
      const state = JSON.parse(stored);
      return !!(state.session && state.isRecording);
    } catch {
      return false;
    }
  }

  /**
   * Resume a persisted session (for multi-page apps).
   * Call this on page load to continue recording across navigation.
   * Returns true if session was resumed, false otherwise.
   */
  public resume(): boolean {
    if (this.isRecording) {
      console.warn('GremlinRecorder: Already recording');
      return false;
    }

    if (!this.loadFromStorage()) {
      return false;
    }

    // Re-setup event listeners
    this.setupEventListeners();

    // Restart rrweb recording
    this.startRrwebRecording();

    // Restart performance sampling
    if (this.config.capturePerformance) {
      this.startPerformanceSampling();
    }

    // Record navigation event for the new page
    const navigationEvent: Omit<GremlinEvent, 'dt'> = {
      type: 6 as EventTypeEnum.NAVIGATION,
      data: {
        kind: 'navigation',
        navType: 'page_load',
        screen: document.title,
        url: window.location.href,
      } as NavigationEvent,
    };
    this.addEventToSession(navigationEvent);

    console.log(`GremlinRecorder: Resumed session ${this.session!.header.sessionId} on ${window.location.pathname}`);
    return true;
  }
}
