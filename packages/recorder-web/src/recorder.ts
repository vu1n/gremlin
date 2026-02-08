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
  InputEvent,
  NavigationEvent,
  NetworkEvent,
} from '@gremlin/session';
import {
  BaseRecorder,
  type BaseRecorderConfig,
  LocalTransport,
  type LocalTransportConfig,
  StreamingTransport,
  type StreamingTransportConfig,
} from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';
import { captureElement, findInteractiveElement } from './element-capture';
import { WebPerformanceMonitor } from './performance-monitor';

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
    captureNetwork: boolean;
    networkIgnorePatterns: string[];
    rrwebOptions: Partial<recordOptions<eventWithTime>>;
    autoUpload: boolean;
  };

  private stopRrweb: (() => void) | null = null;
  private navigationStartTime = 0;
  private performanceMonitor: WebPerformanceMonitor | null = null;
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;

  /** Network interception */
  private originalFetch: typeof window.fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private networkRequestCounter = 0;
  private xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  /** rrweb events for session replay */
  private rrwebEvents: eventWithTime[] = [];

  /** Local transport for sending sessions to gremlin dev */
  private transport: LocalTransport | null = null;

  /** Streaming transport for real-time event streaming */
  private streamingTransport: StreamingTransport | null = null;
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
      captureNetwork: config.captureNetwork ?? true,
      networkIgnorePatterns: config.networkIgnorePatterns ?? [],
      rrwebOptions: config.rrwebOptions ?? {},
      autoUpload: config.autoUpload ?? transportEnabled,
    };

    // Initialize transport (defaults to local on localhost:3334)
    if (transportEnabled && typeof transportConfig === 'object') {
      this.transport = new LocalTransport(transportConfig);
    }

    // Initialize streaming transport if enabled
    if (config.streaming) {
      const streamingConfig = typeof config.streaming === 'object' ? config.streaming : {};
      this.streamingTransport = new StreamingTransport({
        // Inherit endpoint from transport config so streaming goes to the same server
        endpoint: typeof transportConfig === 'object' ? (transportConfig as any).endpoint : undefined,
        debug: config.debug,
        ...streamingConfig,
      });
    }

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

    super.start();
    this.networkRequestCounter = 0;
    this.navigationStartTime = Date.now();

    // Start streaming transport if enabled
    const session = this.getSession();
    if (this.streamingTransport && session) {
      this.streamingTransport.start(session.header.sessionId);
    }

    // Setup event listeners
    this.setupEventListeners();

    // Start rrweb recording
    this.startRrwebRecording();

    // Start performance sampling
    if (this.webConfig.capturePerformance) {
      this.startPerformanceSampling();
    }

    console.log(`GremlinRecorder: Started session ${session?.header.sessionId}${this.streamingTransport ? ' (streaming)' : ''}`);
  }

  override stop(): GremlinSession | null {
    if (!this.isRecording()) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    // Capture session-level performance before stopping the monitor
    let sessionPerformance = this.performanceMonitor?.getSessionPerformance();

    // Stop rrweb
    if (this.stopRrweb) {
      this.stopRrweb();
      this.stopRrweb = null;
    }

    // Stop performance monitor
    if (this.performanceMonitor) {
      this.performanceMonitor.stop();
      this.performanceMonitor = null;
    }

    // Remove event listeners
    this.removeEventListeners();

    // Restore history API
    this.restoreHistoryApi();

    // BaseRecorder flushes batcher — flushed events get pushed to streaming transport
    const session = super.stop();

    // Stop streaming AFTER super.stop() so batcher-flushed events are included
    if (this.streamingTransport) {
      this.streamingTransport.stop();
    }

    if (session) {
      // Add session-level performance data
      if (sessionPerformance) {
        session.performance = sessionPerformance;
      }

      // Snapshot rrweb events at stop time to avoid async upload races
      (session as any).rrwebEvents = [...this.rrwebEvents];

      console.log(
        `GremlinRecorder: Stopped session ${session.header.sessionId} - ` +
          `${session.events.length} events, ${session.elements.length} elements, ` +
          `${this.rrwebEvents.length} rrweb events`
      );

      // Auto-upload if enabled (skip if streaming, already sent)
      if (this.webConfig.autoUpload && this.transport && !this.streamingTransport) {
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

    // Prefer rrweb snapshot from stop() over live array (which may have been cleared/grown)
    const fullSession = {
      ...sessionToUpload,
      rrwebEvents: (sessionToUpload as any).rrwebEvents || [...this.rrwebEvents],
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
    if (this.performanceMonitor) {
      this.performanceMonitor.stop();
      this.performanceMonitor = null;
    }
    if (this.streamingTransport) {
      this.streamingTransport.stop();
      this.streamingTransport = null;
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
  // Streaming Support
  // ========================================================================

  /**
   * Override to auto-attach performance data and stream events.
   */
  protected override addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    // Auto-attach perf sample if monitor is active and event doesn't already have one
    let enrichedEvent = event;
    if (this.performanceMonitor && !event.perf) {
      enrichedEvent = { ...event, perf: this.performanceMonitor.getCurrentSample() };
    }

    // Call parent implementation
    super.addEventToSession(enrichedEvent);

    // Stream event if enabled
    if (this.streamingTransport && this.isRecording() && this.session) {
      const lastEvent = this.session.events[this.session.events.length - 1];
      if (lastEvent) {
        this.streamingTransport.pushEvent(lastEvent);
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
        if (this.streamingTransport) {
          this.streamingTransport.pushRrwebEvent(event);
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
      this.interceptFetch();
      this.interceptXhr();
    }
  }

  private removeEventListeners(): void {
    this.restoreNetworkInterception();
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
    this.performanceMonitor?.markNavigation();
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
  // Network Interception
  // ========================================================================

  private sanitizeUrl(raw: string): string {
    try {
      const url = new URL(raw, window.location.origin);
      return url.origin + url.pathname;
    } catch {
      return raw;
    }
  }

  private shouldIgnoreUrl(url: string): boolean {
    // Skip data: and blob: URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) return true;

    // Skip requests to the gremlin dev server
    const transportEndpoint = this.transport
      ? (this.transport as any).config?.endpoint ?? 'http://localhost:3334'
      : 'http://localhost:3334';
    try {
      const reqUrl = new URL(url, window.location.origin);
      const devUrl = new URL(transportEndpoint);
      if (reqUrl.hostname === devUrl.hostname && reqUrl.port === devUrl.port) {
        return true;
      }
    } catch {
      // If parsing fails, check for localhost:3334 substring
      if (url.includes('localhost:3334')) return true;
    }

    // Check user-provided ignore patterns
    for (const pattern of this.webConfig.networkIgnorePatterns) {
      if (url.includes(pattern)) return true;
    }

    return false;
  }

  private nextRequestId(): string {
    return `net_${++this.networkRequestCounter}`;
  }

  private interceptFetch(): void {
    this.originalFetch = window.fetch;
    const recorder = this;

    const wrappedFetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const method = init?.method ?? (typeof input === 'string' || input instanceof URL ? 'GET' : input.method) ?? 'GET';

      if (recorder.shouldIgnoreUrl(url)) {
        return recorder.originalFetch!(input, init);
      }

      const requestId = recorder.nextRequestId();
      const sanitizedUrl = recorder.sanitizeUrl(url);
      const startTime = Date.now();

      // Record start event
      if (recorder.isRecording()) {
        recorder.addEventToSession({
          type: EventTypeEnum.NETWORK,
          data: {
            kind: 'network',
            requestId,
            method: method.toUpperCase(),
            url: sanitizedUrl,
            phase: 'start',
          } as NetworkEvent,
        });
      }

      return recorder.originalFetch!(input, init).then(
        (response) => {
          if (recorder.isRecording()) {
            recorder.addEventToSession({
              type: EventTypeEnum.NETWORK,
              data: {
                kind: 'network',
                requestId,
                method: method.toUpperCase(),
                url: sanitizedUrl,
                status: response.status,
                duration: Date.now() - startTime,
                phase: 'end',
              } as NetworkEvent,
            });
          }
          return response;
        },
        (error) => {
          if (recorder.isRecording()) {
            recorder.addEventToSession({
              type: EventTypeEnum.NETWORK,
              data: {
                kind: 'network',
                requestId,
                method: method.toUpperCase(),
                url: sanitizedUrl,
                duration: Date.now() - startTime,
                phase: 'error',
                error: error instanceof Error ? error.message : String(error),
              } as NetworkEvent,
            });
          }
          throw error;
        }
      );
    };

    // Copy static properties from original fetch (e.g., preconnect)
    Object.assign(wrappedFetch, this.originalFetch);
    window.fetch = wrappedFetch as typeof window.fetch;
  }

  private interceptXhr(): void {
    this.originalXhrOpen = XMLHttpRequest.prototype.open;
    this.originalXhrSend = XMLHttpRequest.prototype.send;
    const recorder = this;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      recorder.xhrMetadata.set(this, { method, url: typeof url === 'string' ? url : url.href });
      return recorder.originalXhrOpen!.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = recorder.xhrMetadata.get(this);
      const method: string = meta?.method ?? 'GET';
      const url: string = meta?.url ?? '';

      if (recorder.shouldIgnoreUrl(url)) {
        return recorder.originalXhrSend!.call(this, body);
      }

      const requestId = recorder.nextRequestId();
      const sanitizedUrl = recorder.sanitizeUrl(url);
      const startTime = Date.now();

      if (recorder.isRecording()) {
        recorder.addEventToSession({
          type: EventTypeEnum.NETWORK,
          data: {
            kind: 'network',
            requestId,
            method: method.toUpperCase(),
            url: sanitizedUrl,
            phase: 'start',
          } as NetworkEvent,
        });
      }

      this.addEventListener('load', () => {
        if (recorder.isRecording()) {
          recorder.addEventToSession({
            type: EventTypeEnum.NETWORK,
            data: {
              kind: 'network',
              requestId,
              method: method.toUpperCase(),
              url: sanitizedUrl,
              status: this.status,
              duration: Date.now() - startTime,
              phase: 'end',
            } as NetworkEvent,
          });
        }
      });

      this.addEventListener('error', () => {
        if (recorder.isRecording()) {
          recorder.addEventToSession({
            type: EventTypeEnum.NETWORK,
            data: {
              kind: 'network',
              requestId,
              method: method.toUpperCase(),
              url: sanitizedUrl,
              duration: Date.now() - startTime,
              phase: 'error',
              error: 'Network request failed',
            } as NetworkEvent,
          });
        }
      });

      this.addEventListener('abort', () => {
        if (recorder.isRecording()) {
          recorder.addEventToSession({
            type: EventTypeEnum.NETWORK,
            data: {
              kind: 'network',
              requestId,
              method: method.toUpperCase(),
              url: sanitizedUrl,
              duration: Date.now() - startTime,
              phase: 'error',
              error: 'Request aborted',
            } as NetworkEvent,
          });
        }
      });

      return recorder.originalXhrSend!.call(this, body);
    };
  }

  private restoreNetworkInterception(): void {
    if (this.originalFetch) {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    if (this.originalXhrOpen) {
      XMLHttpRequest.prototype.open = this.originalXhrOpen;
      this.originalXhrOpen = null;
    }
    if (this.originalXhrSend) {
      XMLHttpRequest.prototype.send = this.originalXhrSend;
      this.originalXhrSend = null;
    }
  }

  // ========================================================================
  // Performance Capture
  // ========================================================================

  private startPerformanceSampling(): void {
    this.performanceMonitor = new WebPerformanceMonitor({
      trackFPS: true,
      trackLongTasks: true,
      trackWebVitals: true,
      trackMemory: true,
    });
    this.performanceMonitor.start();
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
    // Access protected members from base class
    (this as any).session = session;
    (this as any).recording = true;
    (this as any).lastEventTimestamp = Date.now();
    (this as any).elementMap = new Map();

    // Rebuild element map using same key generation as BaseRecorder.getOrCreateElement
    let unknownCount = 0;
    session.elements.forEach((el, idx) => {
      const key = el.testId || el.accessibilityLabel || el.text || `_unknown_${unknownCount++}`;
      (this as any).elementMap.set(key, idx);
    });
    // Sync the unknownElementCounter so new elements don't collide
    (this as any).unknownElementCounter = unknownCount;

    // Restore rrweb events if available
    if (Array.isArray(rrwebEventsData)) {
      this.rrwebEvents = rrwebEventsData as eventWithTime[];
    }
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
    this.recordNavigation(document.title, 'push', undefined, window.location.href);

    const session = this.getSession();
    console.log(`GremlinRecorder: Resumed session ${session?.header.sessionId} on ${window.location.pathname}`);
    return true;
  }
}
