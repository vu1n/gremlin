/**
 * GremlinRecorder - Web session recorder
 *
 * Extends BaseRecorder from @gremlin/session for shared batching and event logic.
 * Adds web-specific features: rrweb DOM recording, DOM event listeners,
 * history API interception, and session persistence.
 */

import { record, type recordOptions, type eventWithTime } from 'rrweb';
import type {
  GremlinSession,
  GremlinEvent,
  DeviceInfo,
  AppInfo,
  PerformanceSample,
  InputEvent,
  NavigationEvent,
} from '@gremlin/session';
import { BaseRecorder, type BaseRecorderConfig, LocalTransport, type LocalTransportConfig } from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';
import { captureElement, findInteractiveElement } from './element-capture';

// ============================================================================
// Config
// ============================================================================

export interface RecorderConfig extends BaseRecorderConfig {
  /** App name */
  appName: string;

  /** App version */
  appVersion?: string;

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

  /** Capture rrweb events for replay (default: true) */
  captureRrweb?: boolean;

  /** Callback for rrweb events (for custom storage) */
  onRrwebEvent?: (event: eventWithTime) => void;

  /**
   * Transport configuration for sending sessions.
   * - 'local' (default): Auto-connects to gremlin dev on localhost:3334
   * - LocalTransportConfig: Custom local transport config
   * - false: Disable automatic transport (use exportForReplay() manually)
   */
  transport?: 'local' | LocalTransportConfig | false;

  /** Auto-upload session when stopped (default: true when transport enabled) */
  autoUpload?: boolean;
}

// ============================================================================
// Web Recorder
// ============================================================================

/**
 * Web session recorder.
 * Extends BaseRecorder with:
 * - rrweb DOM recording integration
 * - DOM event listeners (click, input, scroll, error)
 * - History API interception for SPA navigation
 * - Session persistence for multi-page apps
 * - Visibility change handling for flush on tab switch
 */
export class GremlinRecorder extends BaseRecorder {
  private static readonly DEFAULT_STORAGE_KEY = 'gremlin_session';

  private webConfig: RecorderConfig & {
    appVersion: string;
    autoStart: boolean;
    capturePerformance: boolean;
    performanceInterval: number;
    maskInputs: boolean;
    persistSession: boolean;
    storageKey: string;
    captureRrweb: boolean;
    rrwebOptions: Partial<recordOptions<eventWithTime>>;
    autoUpload: boolean;
  };

  private stopRrweb: (() => void) | null = null;
  private performanceTimer: number | null = null;
  private navigationStartTime = 0;
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;

  /** rrweb events for session replay */
  private rrwebEvents: eventWithTime[] = [];

  /** Local transport for sending sessions to gremlin dev */
  private transport: LocalTransport | null = null;

  constructor(config: RecorderConfig) {
    super({
      enableBatching: config.enableBatching ?? true,
      scrollBatchWindow: config.scrollBatchWindow ?? 150,
      debug: config.debug ?? false,
    });

    // Determine if transport is enabled (default: 'local' in development)
    const transportEnabled = config.transport !== false;
    const transportConfig = config.transport === 'local' || config.transport === undefined
      ? {}
      : config.transport;

    this.webConfig = {
      ...config,
      appVersion: config.appVersion ?? '0.0.1',
      autoStart: config.autoStart ?? false,
      capturePerformance: config.capturePerformance ?? true,
      performanceInterval: config.performanceInterval ?? 5000,
      maskInputs: config.maskInputs ?? true,
      persistSession: config.persistSession ?? false,
      storageKey: config.storageKey ?? GremlinRecorder.DEFAULT_STORAGE_KEY,
      captureRrweb: config.captureRrweb ?? true,
      rrwebOptions: config.rrwebOptions ?? {},
      autoUpload: config.autoUpload ?? transportEnabled,
    };

    // Initialize transport (defaults to local on localhost:3334)
    if (transportEnabled && typeof transportConfig === 'object') {
      this.transport = new LocalTransport(transportConfig);
    }

    if (this.webConfig.autoStart) {
      if (document.readyState === 'complete') {
        this.start();
      } else {
        window.addEventListener('load', () => this.start());
      }
    }

    if (this.webConfig.persistSession) {
      this.setupPersistence();
    }
  }

  // ========================================================================
  // Abstract method implementations
  // ========================================================================

  protected getDeviceInfo(): DeviceInfo {
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

  protected getAppInfo(): AppInfo {
    return {
      name: this.webConfig.appName,
      version: this.webConfig.appVersion,
      build: this.webConfig.appBuild,
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
  // Lifecycle
  // ========================================================================

  override start(): void {
    if (this.isRecording()) {
      console.warn('GremlinRecorder: Already recording');
      return;
    }

    super.start();
    this.navigationStartTime = Date.now();

    // Setup event listeners
    this.setupEventListeners();

    // Start rrweb recording
    this.startRrwebRecording();

    // Start performance sampling
    if (this.webConfig.capturePerformance) {
      this.startPerformanceSampling();
    }

    const session = this.getSession();
    console.log(`GremlinRecorder: Started session ${session?.header.sessionId}`);
  }

  override stop(): GremlinSession | null {
    if (!this.isRecording()) {
      console.warn('GremlinRecorder: Not recording');
      return null;
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

    // Restore history API
    this.restoreHistoryApi();

    const session = super.stop();

    if (session) {
      // Add rrweb events to session for replay
      (session as any).rrwebEvents = this.rrwebEvents;

      console.log(
        `GremlinRecorder: Stopped session ${session.header.sessionId} - ` +
          `${session.events.length} events, ${session.elements.length} elements, ` +
          `${this.rrwebEvents.length} rrweb events`
      );

      // Auto-upload if enabled
      if (this.webConfig.autoUpload && this.transport) {
        this.upload(session);
      }
    }

    return session;
  }

  /**
   * Upload a session to the configured transport.
   * Called automatically on stop() if autoUpload is enabled.
   */
  public async upload(session?: GremlinSession): Promise<boolean> {
    if (!this.transport) {
      console.warn('GremlinRecorder: No transport configured');
      return false;
    }

    const sessionToUpload = session || this.getSession();
    if (!sessionToUpload) {
      console.warn('GremlinRecorder: No session to upload');
      return false;
    }

    // Add rrweb events to session
    const fullSession = {
      ...sessionToUpload,
      rrwebEvents: this.rrwebEvents,
    };

    try {
      const result = await this.transport.upload(fullSession as GremlinSession);
      if (result.success) {
        console.log(`GremlinRecorder: Session uploaded via ${result.method}`);
        return true;
      } else {
        console.warn(`GremlinRecorder: Upload failed - ${result.error}`);
        return false;
      }
    } catch (err) {
      console.error('GremlinRecorder: Upload error', err);
      return false;
    }
  }

  override destroy(): void {
    if (this.stopRrweb) {
      this.stopRrweb();
      this.stopRrweb = null;
    }
    if (this.performanceTimer !== null) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }
    this.removeEventListeners();
    this.restoreHistoryApi();
    super.destroy();
  }

  /**
   * Check if currently recording.
   */
  public isActive(): boolean {
    return this.isRecording();
  }

  /**
   * Export session as JSON.
   */
  public exportJson(): string | null {
    const session = this.getSession();
    if (!session) return null;
    return JSON.stringify(session, null, 2);
  }

  /**
   * Get rrweb events for replay.
   * Returns a copy of the events array.
   */
  public getRrwebEvents(): eventWithTime[] {
    return [...this.rrwebEvents];
  }

  /**
   * Export full recording including rrweb events for replay.
   * This is what you need to save for later session replay.
   */
  public exportForReplay(): { session: GremlinSession; rrwebEvents: eventWithTime[] } | null {
    const session = this.getSession();
    if (!session) return null;

    return {
      session,
      rrwebEvents: this.getRrwebEvents(),
    };
  }

  /**
   * Export replay data as JSON string.
   */
  public exportReplayJson(): string | null {
    const data = this.exportForReplay();
    if (!data) return null;
    return JSON.stringify(data, null, 2);
  }

  // ========================================================================
  // rrweb Integration
  // ========================================================================

  private startRrwebRecording(): void {
    // Clear previous rrweb events
    this.rrwebEvents = [];

    const stopFn = record({
      emit: (event: eventWithTime) => {
        if (this.webConfig.captureRrweb) {
          this.rrwebEvents.push(event);
        }
        // Also emit to callback if provided
        this.webConfig.onRrwebEvent?.(event);
      },
      sampling: {
        scroll: 150,
        mousemove: false,
        media: 800,
        input: 'last',
      },
      recordCanvas: false,
      collectFonts: false,
      ...this.webConfig.rrwebOptions,
    });

    if (stopFn) {
      this.stopRrweb = stopFn;
    }
  }

  // ========================================================================
  // Event Listeners
  // ========================================================================

  private setupEventListeners(): void {
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('input', this.handleInput, true);
    document.addEventListener('change', this.handleChange, true);
    document.addEventListener('scroll', this.handleScroll, true);
    window.addEventListener('popstate', this.handlePopState);
    window.addEventListener('error', this.handleError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.interceptHistoryApi();
  }

  private removeEventListeners(): void {
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('scroll', this.handleScroll, true);
    window.removeEventListener('popstate', this.handlePopState);
    window.removeEventListener('error', this.handleError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  // ========================================================================
  // Event Handlers
  // ========================================================================

  private handleClick = (event: MouseEvent): void => {
    if (!this.isRecording()) return;

    const interactiveElement = findInteractiveElement(event.target);
    const targetElement = interactiveElement || (event.target as HTMLElement);

    let elementInfo: Parameters<typeof this.recordTap>[2] | undefined;
    if (targetElement instanceof HTMLElement) {
      elementInfo = captureElement(targetElement);
    }

    const x = Math.round(event.clientX);
    const y = Math.round(event.clientY);

    // Use base class recordTap - all taps are valuable signal
    this.recordTap(x, y, elementInfo);
  };

  private handleInput = (event: Event): void => {
    if (!this.isRecording()) return;

    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const elementInfo = captureElement(target);

    let inputType: 'text' | 'password' | 'email' | 'number' | 'phone' = 'text';
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

    const shouldMask = this.webConfig.maskInputs && (inputType === 'password' || inputType === 'email');
    const value = shouldMask ? '***' : target.value;

    this.recordInput(value, inputType, elementInfo);
  };

  private handleChange = (event: Event): void => {
    if (!this.isRecording()) return;

    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    const elementInfo = captureElement(target);
    this.recordInput(target.value, 'text', elementInfo);
  };

  private handleScroll = (event: Event): void => {
    if (!this.isRecording()) return;

    const target = event.target;
    let scrollX = 0;
    let scrollY = 0;

    if (target === document || target === document.documentElement) {
      scrollY = window.scrollY;
      scrollX = window.scrollX;
    } else if (target instanceof HTMLElement) {
      scrollY = target.scrollTop;
      scrollX = target.scrollLeft;
    }

    // Use base class recordScroll - batching handled by EventBatcher
    this.recordScroll(scrollX, scrollY);
  };

  private handlePopState = (): void => {
    this.recordNavigationEvent();
  };

  private recordNavigationEvent(): void {
    if (!this.isRecording()) return;

    this.navigationStartTime = Date.now();
    this.recordNavigation(document.title, 'push', { url: window.location.href });
  }

  private handleError = (event: Event): void => {
    if (!this.isRecording()) return;

    const errorEvent = event as ErrorEvent;
    const error = (errorEvent as any).error;

    this.recordError(
      errorEvent.message || 'Unknown error',
      'js',
      error?.stack,
      false
    );
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (!this.isRecording()) return;

    this.recordError(
      `Unhandled Promise Rejection: ${event.reason}`,
      'js',
      event.reason?.stack,
      false
    );
  };

  private handleVisibilityChange = (): void => {
    if (!this.isRecording()) return;

    // Flush scroll batch when page goes to background
    if (document.visibilityState === 'hidden') {
      this.flush();
      if (this.webConfig.persistSession) {
        this.saveToStorage();
      }
    }
  };

  // ========================================================================
  // History API Interception
  // ========================================================================

  private interceptHistoryApi(): void {
    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      this.originalPushState!.apply(history, args);
      this.recordNavigationEvent();
    };

    history.replaceState = (...args) => {
      this.originalReplaceState!.apply(history, args);
      this.recordNavigationEvent();
    };
  }

  private restoreHistoryApi(): void {
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
  }

  // ========================================================================
  // Performance Capture
  // ========================================================================

  private startPerformanceSampling(): void {
    this.performanceTimer = window.setInterval(() => {
      // Performance sampling happens during other events
    }, this.webConfig.performanceInterval);
  }

  // ========================================================================
  // Session Persistence (Multi-page Apps)
  // ========================================================================

  private setupPersistence(): void {
    window.addEventListener('beforeunload', () => {
      if (this.isRecording()) {
        this.flush();
        this.saveToStorage();
      }
    });
  }

  private saveToStorage(): void {
    const session = this.getSession();
    if (!session) return;

    try {
      const state = {
        session,
        navigationStartTime: this.navigationStartTime,
        isRecording: this.isRecording(),
      };
      sessionStorage.setItem(this.webConfig.storageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('GremlinRecorder: Failed to save session to storage', e);
    }
  }

  private loadFromStorage(): boolean {
    try {
      const stored = sessionStorage.getItem(this.webConfig.storageKey);
      if (!stored) return false;

      const state = JSON.parse(stored);
      if (!state.session || !state.isRecording) return false;

      // Restore session state via protected access
      // This is a special case for persistence - normally use start()
      this.restoreSession(state.session);
      this.navigationStartTime = state.navigationStartTime || Date.now();

      return true;
    } catch (e) {
      console.warn('GremlinRecorder: Failed to load session from storage', e);
      return false;
    }
  }

  /**
   * Restore a session from persistence.
   * Protected method to allow subclasses to restore state.
   */
  protected restoreSession(session: GremlinSession): void {
    // Access protected members from base class
    (this as any).session = session;
    (this as any).recording = true;
    (this as any).lastEventTimestamp = Date.now();
    (this as any).elementMap = new Map();

    // Rebuild element map from session
    session.elements.forEach((el, idx) => {
      const key = el.testId || el.accessibilityLabel || el.text || 'unknown';
      (this as any).elementMap.set(key, idx);
    });
  }

  /**
   * Clear persisted session from storage.
   */
  public clearStorage(): void {
    try {
      sessionStorage.removeItem(this.webConfig.storageKey);
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Check if there's a persisted session that can be resumed.
   */
  public hasPersistentSession(): boolean {
    try {
      const stored = sessionStorage.getItem(this.webConfig.storageKey);
      if (!stored) return false;
      const state = JSON.parse(stored);
      return !!(state.session && state.isRecording);
    } catch {
      return false;
    }
  }

  /**
   * Resume a persisted session (for multi-page apps).
   */
  public resume(): boolean {
    if (this.isRecording()) {
      console.warn('GremlinRecorder: Already recording');
      return false;
    }

    if (!this.loadFromStorage()) {
      return false;
    }

    this.setupEventListeners();
    this.startRrwebRecording();

    if (this.webConfig.capturePerformance) {
      this.startPerformanceSampling();
    }

    // Record navigation event for the new page
    this.recordNavigation(document.title, 'push', { url: window.location.href });

    const session = this.getSession();
    console.log(`GremlinRecorder: Resumed session ${session?.header.sessionId} on ${window.location.pathname}`);
    return true;
  }
}
