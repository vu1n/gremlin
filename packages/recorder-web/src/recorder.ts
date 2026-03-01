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
  UploadResult,
  LocalTransportConfig,
  StreamingTransportConfig,
} from '@gremlin/session';
import {
  BaseRecorder,
  type BaseRecorderConfig,
} from '@gremlin/session';
import { captureElement, findInteractiveElement } from './element-capture.ts';
import { TransportCapability, PerformanceCapability } from './capabilities.ts';

export interface RecorderConfig extends BaseRecorderConfig {
  appName: string;
  appVersion?: string;
  appBuild?: string;

  /** Auto-start recording on page load */
  autoStart?: boolean;

  /** Sample performance metrics */
  capturePerformance?: boolean;

  /** Performance sample interval (ms) */
  performanceInterval?: number;

  maskInputs?: boolean;

  /** Emit events to callback (for real-time streaming) */
  onEvent?: (event: GremlinEvent) => void;

  rrwebOptions?: Partial<recordOptions<eventWithTime>>;

  /** Persist session to sessionStorage for multi-page apps */
  persistSession?: boolean;

  /** Storage key for session persistence */
  storageKey?: string;

  /** Capture rrweb events for replay (default: true) */
  captureRrweb?: boolean;

  /** Capture network requests (fetch and XHR) (default: true) */
  captureNetwork?: boolean;

  /** URL patterns to ignore for network capture (substring match) */
  networkIgnorePatterns?: string[];

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

  /**
   * Enable streaming mode - events are sent to server in real-time.
   * Only works with local transport. Great for local dev to avoid data loss.
   * - true: Enable streaming with default 2s batch interval
   * - StreamingTransportConfig: Custom streaming config
   * - false (default): Batch upload on stop()
   */
  streaming?: boolean | StreamingTransportConfig;
}

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
    captureNetwork: boolean;
    networkIgnorePatterns: string[];
    rrwebOptions: Partial<recordOptions<eventWithTime>>;
    autoUpload: boolean;
  };

  private stopRrweb: (() => void) | null = null;
  private navigationStartTime = 0;
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;

  /** rrweb events for session replay */
  private rrwebEvents: eventWithTime[] = [];

  /** Capability: transport (local + streaming) lifecycle */
  private transportCap: TransportCapability;

  /** Capability: performance monitoring lifecycle */
  private performanceCap: PerformanceCapability;

  private scrollPositions = new WeakMap<EventTarget, { x: number; y: number }>();
  private documentScrollPos = { x: 0, y: 0 };
  private beforeUnloadHandler: (() => void) | null = null;
  private autoStartLoadHandler: (() => void) | null = null;

  constructor(config: RecorderConfig) {
    super({
      enableBatching: config.enableBatching ?? true,
      scrollBatchWindow: config.scrollBatchWindow ?? 150,
      debug: config.debug ?? false,
    });

    const transportEnabled = config.transport !== false;

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
      captureNetwork: config.captureNetwork ?? true,
      networkIgnorePatterns: config.networkIgnorePatterns ?? [],
      rrwebOptions: config.rrwebOptions ?? {},
      autoUpload: config.autoUpload ?? transportEnabled,
    };

    // Register transport capability (manages LocalTransport + StreamingTransport lifecycle)
    this.transportCap = new TransportCapability(
      {
        transport: config.transport,
        streaming: config.streaming,
        autoUpload: config.autoUpload ?? transportEnabled,
        debug: config.debug,
      },
      () => this.getSession(),
    );
    this.registerCapability(this.transportCap);

    // Register performance capability (manages WebPerformanceMonitor lifecycle)
    this.performanceCap = new PerformanceCapability(
      { capturePerformance: config.capturePerformance },
      (provider) => { this.performanceProvider = provider; },
    );
    this.registerCapability(this.performanceCap);

    if (this.webConfig.autoStart) {
      if (document.readyState === 'complete') {
        this.start();
      } else {
        this.autoStartLoadHandler = () => this.start();
        window.addEventListener('load', this.autoStartLoadHandler);
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

    // BaseRecorder creates session, then calls start() on all registered capabilities
    // (TransportCapability starts streaming, PerformanceCapability starts monitor)
    super.start();
    this.navigationStartTime = Date.now();

    // Setup event listeners
    this.setupEventListeners();

    // Start rrweb recording
    this.startRrwebRecording();

    const session = this.getSession();
    console.log(`GremlinRecorder: Started session ${session?.header.sessionId}${this.transportCap.isStreaming() ? ' (streaming)' : ''}`);
  }

  override stop(): GremlinSession | null {
    if (!this.isRecording()) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    // Capture session-level performance before base.stop() cleans up the provider
    const sessionPerformance = this.performanceCap.getMonitor()?.getSessionPerformance();

    // Stop rrweb
    if (this.stopRrweb) {
      this.stopRrweb();
      this.stopRrweb = null;
    }

    // Remove DOM event listeners (network interceptor cleanup handled by base)
    this.removeEventListeners();

    // Restore history API
    this.restoreHistoryApi();

    // BaseRecorder stops capabilities (reverse order: performance then transport),
    // stops perf provider, uninstalls network interceptor, flushes batcher
    const session = super.stop();

    if (session) {
      // Add session-level performance data
      if (sessionPerformance) {
        session.performance = sessionPerformance;
      }

      // Snapshot rrweb events at stop time to avoid async upload races
      session.rrwebEvents = [...this.rrwebEvents];

      console.log(
        `GremlinRecorder: Stopped session ${session.header.sessionId} - ` +
          `${session.events.length} events, ${session.elements.length} elements, ` +
          `${this.rrwebEvents.length} rrweb events`
      );

      // Auto-upload if enabled (skip if streaming, already sent)
      if (this.transportCap.shouldUploadOnStop()) {
        this.transportCap.uploadSession(session);
      }
    }

    return session;
  }

  /**
   * Upload a session to the configured transport.
   * Called automatically on stop() if autoUpload is enabled.
   * Delegates to TransportCapability which owns the upload workflow.
   */
  public async upload(session?: GremlinSession): Promise<UploadResult> {
    const sessionToUpload = session || this.getSession();
    return this.transportCap.uploadSession(sessionToUpload ?? undefined, [...this.rrwebEvents]);
  }

  override destroy(): void {
    if (this.stopRrweb) {
      this.stopRrweb();
      this.stopRrweb = null;
    }
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.autoStartLoadHandler) {
      window.removeEventListener('load', this.autoStartLoadHandler);
      this.autoStartLoadHandler = null;
    }
    this.removeEventListeners();
    this.restoreHistoryApi();
    // BaseRecorder.destroy() calls destroy() on all capabilities (transport, performance)
    // and cleans up performanceProvider, networkInterceptor, batcher
    super.destroy();
  }

  public isActive(): boolean {
    return this.isRecording();
  }

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

  public exportReplayJson(): string | null {
    const data = this.exportForReplay();
    if (!data) return null;
    return JSON.stringify(data, null, 2);
  }

  // ========================================================================
  // Streaming Support
  // ========================================================================

  /**
   * Override to stream events to the streaming transport.
   * Performance enrichment is handled by BaseRecorder via performanceProvider.
   */
  protected override addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    // Call parent implementation (handles perf enrichment, dt, session push)
    super.addEventToSession(event);

    // Stream event if enabled
    const streamingTransport = this.transportCap.getStreamingTransport();
    if (streamingTransport && this.isRecording() && this.session) {
      const lastEvent = this.session.events[this.session.events.length - 1];
      if (lastEvent) {
        streamingTransport.pushEvent(lastEvent);
      }
    }
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
          // Cap rrweb events to prevent unbounded memory growth in long sessions
          const MAX_RRWEB_EVENTS = 10_000;
          if (this.rrwebEvents.length >= MAX_RRWEB_EVENTS) {
            // Keep the most recent 75% to preserve continuity
            this.rrwebEvents = this.rrwebEvents.slice(-Math.floor(MAX_RRWEB_EVENTS * 0.75));
          }
          this.rrwebEvents.push(event);
        }
        // Stream rrweb event if enabled
        const streamingTransport = this.transportCap.getStreamingTransport();
        if (streamingTransport) {
          streamingTransport.pushRrwebEvent(event);
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

    if (this.webConfig.captureNetwork) {
      const transport = this.transportCap.getTransport();
      const transportEndpoint = transport
        ? transport.getEndpoint()
        : 'http://localhost:3334';
      this.installNetworkInterceptor({
        addEvent: (event) => this.addEventToSession(event),
        isRecording: () => this.isRecording(),
        ignorePatterns: this.webConfig.networkIgnorePatterns,
        transportEndpoint,
        urlBase: window.location.origin,
      });
    }
  }

  private removeEventListeners(): void {
    // Note: network interceptor cleanup is handled by BaseRecorder.stop()/destroy()
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

    // Handle contenteditable elements (rich text editors like Tiptap, Slate, etc.)
    if (target instanceof HTMLElement && target.isContentEditable &&
        !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const elementInfo = captureElement(target);
      const value = this.webConfig.maskInputs ? '***' : (target.textContent ?? '');
      this.recordInput(value, 'text', elementInfo);
      return;
    }

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
    if (!target) return;

    let absX = 0;
    let absY = 0;
    let isDocument = false;

    if (target === document || target === document.documentElement) {
      absY = window.scrollY;
      absX = window.scrollX;
      isDocument = true;
    } else if (target instanceof HTMLElement) {
      absY = target.scrollTop;
      absX = target.scrollLeft;
    }

    // Compute delta from last known position for THIS specific target
    let prev: { x: number; y: number };
    if (isDocument) {
      prev = this.documentScrollPos;
    } else if (target) {
      prev = this.scrollPositions.get(target) ?? { x: 0, y: 0 };
    } else {
      prev = { x: 0, y: 0 };
    }

    const deltaX = absX - prev.x;
    const deltaY = absY - prev.y;

    if (isDocument) {
      this.documentScrollPos = { x: absX, y: absY };
    } else if (target) {
      this.scrollPositions.set(target, { x: absX, y: absY });
    }

    // Use base class recordScroll - batching handled by EventBatcher
    this.recordScroll(deltaX, deltaY);
  };

  private handlePopState = (): void => {
    this.recordNavigationWithType('pop');
  };

  private recordNavigationWithType(navType: 'push' | 'pop' | 'replace' = 'push'): void {
    if (!this.isRecording()) return;

    this.navigationStartTime = Date.now();
    this.performanceProvider?.markNavigation();
    this.recordNavigation(document.title, navType, undefined, window.location.href);
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
      this.recordNavigationWithType('push');
    };

    history.replaceState = (...args) => {
      this.originalReplaceState!.apply(history, args);
      this.recordNavigationWithType('replace');
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
  // Session Persistence (Multi-page Apps)
  // ========================================================================

  private setupPersistence(): void {
    this.beforeUnloadHandler = () => {
      if (this.isRecording()) {
        this.flush();
        this.saveToStorage();
      }
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  private saveToStorage(): void {
    const session = this.getSession();
    if (!session) return;

    try {
      const state = {
        session,
        rrwebEvents: this.rrwebEvents,
        navigationStartTime: this.navigationStartTime,
        isRecording: this.isRecording(),
      };
      sessionStorage.setItem(this.webConfig.storageKey, JSON.stringify(state));
    } catch (e) {
      // sessionStorage may be full — try without rrweb events as fallback
      try {
        const fallbackState = {
          session,
          navigationStartTime: this.navigationStartTime,
          isRecording: this.isRecording(),
        };
        sessionStorage.setItem(this.webConfig.storageKey, JSON.stringify(fallbackState));
      } catch {
        console.warn('GremlinRecorder: Failed to save session to storage', e);
      }
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
      this.restoreSession(state.session, state.rrwebEvents);
      this.navigationStartTime = state.navigationStartTime || Date.now();

      if (!state.rrwebEvents) {
        console.warn('GremlinRecorder: rrweb events not persisted (storage quota). DOM replay will start from this page.');
      }

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
  protected restoreSession(session: GremlinSession, rrwebEventsData?: unknown[]): void {
    // Rebuild element map using same key generation as BaseRecorder.getOrCreateElement
    const elementMap = new Map<string, number>();
    let unknownCount = 0;
    session.elements.forEach((el, idx) => {
      const key = el.testId || el.accessibilityLabel || el.text || `_unknown_${unknownCount++}`;
      elementMap.set(key, idx);
    });

    // Restore base class state via typed method
    this.restoreState({
      session,
      recording: true,
      lastEventTimestamp: Date.now(),
      elementMap,
      unknownElementCounter: unknownCount,
    });

    // Restore rrweb events if available
    if (Array.isArray(rrwebEventsData)) {
      this.rrwebEvents = rrwebEventsData as eventWithTime[];
    }
  }

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

    // Start capabilities for the resumed session (transport streaming, performance monitor)
    this.transportCap.start();
    this.performanceCap.start();

    // Record navigation event for the new page
    this.recordNavigation(document.title, 'push', undefined, window.location.href);

    const session = this.getSession();
    console.log(`GremlinRecorder: Resumed session ${session?.header.sessionId} on ${window.location.pathname}`);
    return true;
  }
}
