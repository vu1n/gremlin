/**
 * GremlinRecorder - React Native session recorder
 *
 * Extends BaseRecorder from @gremlin/session for shared batching,
 * element deduplication, and delta-encoded timestamps.
 * Adds RN-specific features: gesture interception, navigation tracking,
 * performance monitoring, app state tracking, network capture, and error capture.
 */

import { Platform, Dimensions, AppState, type AppStateStatus, NativeModules } from 'react-native';
import type {
  GremlinSession,
  GremlinEvent,
  TapEvent,
  SwipeEvent,
  NetworkEvent,
  DeviceInfo,
  AppInfo,
} from '@gremlin/session';
import { BaseRecorder, type BaseRecorderConfig, EventTypeEnum } from '@gremlin/session';
import { GestureInterceptor, type GestureEvent } from './gesture-interceptor';
import { NavigationListener, type NavigationChange } from './navigation-listener';
import { PerformanceMonitor } from './performance-monitor';
import { captureElement, toElementInfo, findInteractiveParent } from './element-capture';
import { LocalTransport, type TransportResult } from './transport';
import type { GremlinRecorderConfig, NavigationRef, TransportConfig } from './types';

// ErrorUtils is a global in React Native but not typed
declare const ErrorUtils: {
  getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

/**
 * Main recorder class for React Native.
 * Extends BaseRecorder for shared session lifecycle, event batching,
 * element deduplication, and delta timestamps.
 */
export class GremlinRecorder extends BaseRecorder {
  private rnConfig: Required<
    Omit<GremlinRecorderConfig, 'appBuild' | 'onEvent' | 'navigationRef' | 'transport'>
  > & {
    appBuild?: string;
    onEvent?: (event: GremlinEvent) => void;
    transport?: TransportConfig | false;
  };

  // Sub-modules
  private gestureInterceptor: GestureInterceptor | null = null;
  private navigationListener: NavigationListener | null = null;
  private performanceMonitor: PerformanceMonitor | null = null;
  private transport: LocalTransport | null = null;

  // App state tracking
  private appStateSubscription: any = null;

  // Error tracking - saved previous handler for restore on stop
  private previousErrorHandler: ((error: Error, isFatal?: boolean) => void) | null = null;

  // Network interception
  private originalFetch: typeof globalThis.fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private networkRequestCounter = 0;
  private xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  constructor(config: GremlinRecorderConfig) {
    super({
      enableBatching: true,
      scrollBatchWindow: config.scrollDebounce ?? 150,
      debug: false,
    } satisfies BaseRecorderConfig);

    this.rnConfig = {
      appName: config.appName,
      appVersion: config.appVersion,
      appBuild: config.appBuild,
      autoStart: config.autoStart ?? false,
      transport: config.transport,
      capturePerformance: config.capturePerformance ?? true,
      performanceInterval: config.performanceInterval ?? 5000,
      maskInputs: config.maskInputs ?? true,
      onEvent: config.onEvent,
      captureGestures: config.captureGestures ?? true,
      captureNavigation: config.captureNavigation ?? true,
      minSwipeDistance: config.minSwipeDistance ?? 30,
      longPressDuration: config.longPressDuration ?? 500,
      doubleTapDelay: config.doubleTapDelay ?? 300,
      scrollDebounce: config.scrollDebounce ?? 150,
      captureNetwork: config.captureNetwork ?? true,
      networkIgnorePatterns: config.networkIgnorePatterns ?? [],
    };

    // Initialize transport if not disabled
    if (config.transport !== false) {
      this.transport = new LocalTransport(config.transport);
    }
  }

  // ========================================================================
  // Abstract method implementations (required by BaseRecorder)
  // ========================================================================

  protected getDeviceInfo(): DeviceInfo {
    const { width, height, scale } = Dimensions.get('window');

    return {
      platform: Platform.OS as 'ios' | 'android',
      osVersion: Platform.Version.toString(),
      model: this.getDeviceModel(),
      screen: {
        width: Math.round(width),
        height: Math.round(height),
        pixelRatio: scale,
      },
      locale: this.getLocale(),
    };
  }

  protected getAppInfo(): AppInfo {
    return {
      name: this.rnConfig.appName,
      version: this.rnConfig.appVersion,
      build: this.rnConfig.appBuild,
      identifier: this.getBundleId(),
    };
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Start recording session.
   * Delegates session creation to BaseRecorder, then sets up RN-specific listeners.
   */
  public override start(navigationRef?: NavigationRef): void {
    if (this.isRecording()) {
      console.warn('GremlinRecorder: Already recording');
      return;
    }

    // BaseRecorder creates session, sets recording=true, initializes timestamps
    super.start();
    this.networkRequestCounter = 0;

    // Start transport batching if enabled
    const session = this.getSession();
    if (this.transport && session) {
      this.transport.startBatching(session.header.sessionId);
    }

    // Setup gesture interception
    if (this.rnConfig.captureGestures) {
      this.setupGestureInterceptor();
    }

    // Setup navigation listener
    if (this.rnConfig.captureNavigation && navigationRef) {
      this.setupNavigationListener(navigationRef);
    }

    // Setup performance monitor
    if (this.rnConfig.capturePerformance) {
      this.setupPerformanceMonitor();
    }

    // Setup app state listener
    this.setupAppStateListener();

    // Setup error tracking via ErrorUtils
    this.setupErrorTracking();

    // Setup network interception
    if (this.rnConfig.captureNetwork) {
      this.interceptFetch();
      this.interceptXhr();
    }

    console.log(`GremlinRecorder: Started session ${session?.header.sessionId}`);
  }

  /**
   * Stop recording and return session.
   * Cleans up RN-specific listeners, then delegates to BaseRecorder.
   */
  public override stop(): GremlinSession | null {
    if (!this.isRecording()) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    // Stop transport batching
    if (this.transport) {
      this.transport.stopBatching();
    }

    // Cleanup RN-specific listeners before stopping base
    this.cleanupListeners();

    // BaseRecorder flushes batcher, sets recording=false, sets endTime
    const finalSession = super.stop();

    if (finalSession) {
      console.log(
        `GremlinRecorder: Stopped session ${finalSession.header.sessionId} - ` +
          `${finalSession.events.length} events, ${finalSession.elements.length} elements`
      );

      // Auto-upload if transport is configured
      if (this.transport) {
        this.transport.upload(finalSession).then((result) => {
          if (result.success) {
            console.log(`GremlinRecorder: Session uploaded via ${result.method}`);
          } else {
            console.warn(`GremlinRecorder: Upload failed - ${result.error}`);
          }
        }).catch((err) => {
          console.warn('GremlinRecorder: Upload error', err);
        });
      }
    }

    return finalSession;
  }

  /**
   * Stop recording and upload session (async version).
   * Returns the upload result along with the session.
   */
  public async stopAndUpload(): Promise<{ session: GremlinSession | null; uploadResult: TransportResult | null }> {
    const session = this.stopWithoutUpload();

    if (!session || !this.transport) {
      return { session, uploadResult: null };
    }

    const uploadResult = await this.transport.upload(session);
    return { session, uploadResult };
  }

  /**
   * Stop recording without auto-upload (for manual handling).
   */
  public stopWithoutUpload(): GremlinSession | null {
    if (!this.isRecording()) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    // Stop transport batching but don't upload
    if (this.transport) {
      this.transport.stopBatching();
    }

    // Cleanup RN-specific listeners
    this.cleanupListeners();

    // BaseRecorder flushes batcher, sets recording=false, sets endTime
    const finalSession = super.stop();

    if (finalSession) {
      console.log(
        `GremlinRecorder: Stopped session ${finalSession.header.sessionId} - ` +
          `${finalSession.events.length} events, ${finalSession.elements.length} elements`
      );
    }

    return finalSession;
  }

  /**
   * Manually upload a session.
   */
  public async uploadSession(session: GremlinSession): Promise<TransportResult | null> {
    if (!this.transport) {
      console.warn('GremlinRecorder: Transport not configured');
      return null;
    }
    return this.transport.upload(session);
  }

  /**
   * Check if dev server is available.
   */
  public async checkServer(): Promise<boolean> {
    if (!this.transport) return false;
    return this.transport.checkServer();
  }

  /**
   * Check if currently recording.
   */
  public isActive(): boolean {
    return this.isRecording();
  }

  /**
   * Get gesture interceptor (for use with GremlinProvider).
   */
  public getGestureInterceptor(): GestureInterceptor | null {
    return this.gestureInterceptor;
  }

  public override destroy(): void {
    this.cleanupListeners();
    if (this.transport) {
      this.transport.stopBatching();
    }
    super.destroy();
  }

  // ========================================================================
  // Event Recording Override
  // ========================================================================

  /**
   * Override to auto-attach performance data and emit to onEvent callback.
   */
  protected override addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    // Auto-attach perf sample if monitor is active and event doesn't already have one
    let enrichedEvent = event;
    if (this.performanceMonitor && !event.perf) {
      enrichedEvent = { ...event, perf: this.performanceMonitor.getCurrentSample() };
    }

    // Call parent implementation (handles delta timestamps, session push, debug logging)
    super.addEventToSession(enrichedEvent);

    // Queue event for transport batching
    if (this.transport && this.session) {
      const fullEvent = this.session.events[this.session.events.length - 1];
      if (fullEvent) {
        this.transport.queueEvent(fullEvent);
      }
    }

    // Emit to callback if configured
    if (this.rnConfig.onEvent && this.session) {
      const fullEvent = this.session.events[this.session.events.length - 1];
      if (fullEvent) {
        this.rnConfig.onEvent(fullEvent);
      }
    }
  }

  // ========================================================================
  // Private Methods - Device Info Helpers
  // ========================================================================

  private getDeviceModel(): string | undefined {
    try {
      if (Platform.OS === 'ios') {
        return NativeModules.DeviceInfo?.model;
      } else if (Platform.OS === 'android') {
        return NativeModules.DeviceInfo?.model;
      }
    } catch {
      // Ignore errors
    }
    return undefined;
  }

  private getLocale(): string | undefined {
    try {
      if (Platform.OS === 'ios') {
        return NativeModules.SettingsManager?.settings?.AppleLocale ||
               NativeModules.SettingsManager?.settings?.AppleLanguages?.[0];
      } else if (Platform.OS === 'android') {
        return NativeModules.I18nManager?.localeIdentifier;
      }
    } catch {
      // Ignore errors
    }
    return undefined;
  }

  private getBundleId(): string {
    try {
      if (Platform.OS === 'ios') {
        return NativeModules.DeviceInfo?.bundleId || 'unknown';
      } else if (Platform.OS === 'android') {
        return NativeModules.DeviceInfo?.packageName || 'unknown';
      }
    } catch {
      // Ignore errors
    }
    return 'unknown';
  }

  // ========================================================================
  // Private Methods - Module Setup
  // ========================================================================

  private setupGestureInterceptor(): void {
    this.gestureInterceptor = new GestureInterceptor({
      onGesture: this.handleGesture,
      minSwipeDistance: this.rnConfig.minSwipeDistance,
      longPressDuration: this.rnConfig.longPressDuration,
      doubleTapDelay: this.rnConfig.doubleTapDelay,
    });
  }

  private setupNavigationListener(navigationRef: NavigationRef): void {
    this.navigationListener = new NavigationListener({
      onNavigationChange: this.handleNavigationChange,
      navigationRef,
      maskParams: this.rnConfig.maskInputs,
    });

    this.navigationListener.start(navigationRef);
  }

  private setupPerformanceMonitor(): void {
    this.performanceMonitor = new PerformanceMonitor({
      sampleInterval: this.rnConfig.performanceInterval,
      trackFPS: true,
      trackMemory: true,
      trackJSLag: true,
    });

    this.performanceMonitor.start();
  }

  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange
    );
  }

  private setupErrorTracking(): void {
    try {
      if (typeof ErrorUtils !== 'undefined') {
        // Save previous handler so we can restore on stop and chain calls
        this.previousErrorHandler = ErrorUtils.getGlobalHandler();

        ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
          // Record error event via BaseRecorder's recordError
          this.recordError(
            error.message,
            'js',
            error.stack,
            isFatal ?? false
          );

          // Chain to previous handler so other error reporters still work
          if (this.previousErrorHandler) {
            this.previousErrorHandler(error, isFatal);
          }
        });
      }
    } catch {
      // ErrorUtils may not be available in all environments (e.g. tests)
    }
  }

  private teardownErrorTracking(): void {
    try {
      if (typeof ErrorUtils !== 'undefined' && this.previousErrorHandler) {
        ErrorUtils.setGlobalHandler(this.previousErrorHandler);
        this.previousErrorHandler = null;
      }
    } catch {
      // Ignore
    }
  }

  private cleanupListeners(): void {
    if (this.gestureInterceptor) {
      this.gestureInterceptor.cleanup();
      this.gestureInterceptor = null;
    }

    if (this.navigationListener) {
      this.navigationListener.stop();
      this.navigationListener = null;
    }

    if (this.performanceMonitor) {
      this.performanceMonitor.stop();
      this.performanceMonitor = null;
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    this.teardownErrorTracking();
    this.restoreNetworkInterception();
  }

  // ========================================================================
  // Private Methods - Network Interception
  // ========================================================================

  private sanitizeUrl(raw: string): string {
    try {
      const url = new URL(raw);
      return url.origin + url.pathname;
    } catch {
      return raw;
    }
  }

  private shouldIgnoreUrl(url: string): boolean {
    // Skip data: and blob: URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) return true;

    // Skip requests to the gremlin transport endpoint
    const transportEndpoint = this.transport
      ? (this.transport as any).config?.endpoint ?? 'http://localhost:3334'
      : 'http://localhost:3334';
    try {
      const reqUrl = new URL(url);
      const devUrl = new URL(transportEndpoint);
      if (reqUrl.hostname === devUrl.hostname && reqUrl.port === devUrl.port) {
        return true;
      }
    } catch {
      if (url.includes('localhost:3334')) return true;
    }

    // Check user-provided ignore patterns
    for (const pattern of this.rnConfig.networkIgnorePatterns) {
      if (url.includes(pattern)) return true;
    }

    return false;
  }

  private nextRequestId(): string {
    return `net_${++this.networkRequestCounter}`;
  }

  private interceptFetch(): void {
    this.originalFetch = globalThis.fetch;
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
    globalThis.fetch = wrappedFetch as typeof globalThis.fetch;
  }

  private interceptXhr(): void {
    // XMLHttpRequest may not be available in all RN environments
    if (typeof XMLHttpRequest === 'undefined') return;

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
      globalThis.fetch = this.originalFetch;
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
  // Private Methods - Event Handlers
  // ========================================================================

  private handleGesture = async (gesture: GestureEvent): Promise<void> => {
    if (!this.isRecording()) return;

    try {
      // Find interactive element if target is available
      let elementIndex: number | undefined;
      if (gesture.target) {
        const interactiveElement = findInteractiveParent(gesture.target);
        const elementInfo = await captureElement(interactiveElement || gesture.target);
        if (elementInfo) {
          elementIndex = this.getOrCreateElement(toElementInfo(elementInfo));
        }
      }

      // Create event based on gesture type
      if (gesture.type === 'swipe') {
        this.addEventToSession({
          type: EventTypeEnum.SWIPE,
          data: {
            kind: 'swipe',
            startX: gesture.startX!,
            startY: gesture.startY!,
            endX: gesture.endX!,
            endY: gesture.endY!,
            duration: gesture.duration!,
            direction: gesture.direction!,
          } as SwipeEvent,
        });
      } else {
        const eventType = gesture.type === 'double_tap'
          ? EventTypeEnum.DOUBLE_TAP
          : gesture.type === 'long_press'
          ? EventTypeEnum.LONG_PRESS
          : EventTypeEnum.TAP;

        this.addEventToSession({
          type: eventType,
          data: {
            kind: gesture.type === 'double_tap'
              ? 'double_tap'
              : gesture.type === 'long_press'
              ? 'long_press'
              : 'tap',
            x: gesture.x,
            y: gesture.y,
            elementIndex,
          } as TapEvent,
        });
      }
    } catch (error) {
      console.warn('Failed to handle gesture:', error);
    }
  };

  private handleNavigationChange = (change: NavigationChange): void => {
    if (!this.isRecording()) return;

    // Reset performance monitor navigation timer
    if (this.performanceMonitor) {
      this.performanceMonitor.markNavigation();
    }

    // Use BaseRecorder's recordNavigation which handles currentScreen tracking
    this.recordNavigation(change.screen, change.type);
  };

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (!this.isRecording()) return;

    // Use BaseRecorder's recordAppState which handles flush on background
    this.recordAppState(nextAppState as 'active' | 'background' | 'inactive');
  };
}
