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
  DeviceInfo,
  AppInfo,
  UploadResult,
} from '@gremlin/session';
import { BaseRecorder, type BaseRecorderConfig, EventTypeEnum } from '@gremlin/session';
import { GestureInterceptor, type GestureEvent } from './gesture-interceptor';
import { NavigationListener, type NavigationChange } from './navigation-listener';
import { captureElement, toElementInfo, findInteractiveParent, type RNComponentRef } from './element-capture';
import { RNTransportCapability, RNPerformanceCapability } from './capabilities';
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

  // Capabilities
  private transportCap: RNTransportCapability;
  private performanceCap: RNPerformanceCapability;

  // App state tracking
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  // Error tracking - saved previous handler for restore on stop
  private previousErrorHandler: ((error: Error, isFatal?: boolean) => void) | null = null;

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

    // Register transport capability (manages LocalTransport batching lifecycle and upload policy)
    const transportAutoUpload = config.transport !== false &&
      (typeof config.transport === 'object' ? config.transport.autoUpload : undefined);
    this.transportCap = new RNTransportCapability(
      { transport: config.transport, autoUpload: transportAutoUpload },
      () => this.getSession(),
    );
    this.registerCapability(this.transportCap);

    // Register performance capability (manages PerformanceMonitor lifecycle)
    this.performanceCap = new RNPerformanceCapability(
      { capturePerformance: config.capturePerformance, performanceInterval: config.performanceInterval },
      (provider) => { this.performanceProvider = provider; },
    );
    this.registerCapability(this.performanceCap);
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

    // BaseRecorder creates session, sets recording=true, initializes timestamps,
    // then calls start() on all registered capabilities (transport batching, performance monitor)
    super.start();

    // Setup gesture interception
    if (this.rnConfig.captureGestures) {
      this.setupGestureInterceptor();
    }

    // Setup navigation listener
    if (this.rnConfig.captureNavigation && navigationRef) {
      this.setupNavigationListener(navigationRef);
    }

    // Setup app state listener
    this.setupAppStateListener();

    // Setup error tracking via ErrorUtils
    this.setupErrorTracking();

    // Setup network interception (lifecycle managed by BaseRecorder)
    if (this.rnConfig.captureNetwork) {
      const transportEndpoint = (this.rnConfig.transport && typeof this.rnConfig.transport === 'object')
        ? this.rnConfig.transport.endpoint ?? 'http://localhost:3334'
        : 'http://localhost:3334';
      this.installNetworkInterceptor({
        addEvent: (event) => this.addEventToSession(event),
        isRecording: () => this.isRecording(),
        ignorePatterns: this.rnConfig.networkIgnorePatterns,
        transportEndpoint,
      });
    }

    const session = this.getSession();
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

    // Cleanup RN-specific listeners before stopping base
    this.cleanupListeners();

    // BaseRecorder stops capabilities (reverse order: performance then transport),
    // flushes batcher, sets recording=false, sets endTime
    const finalSession = super.stop();

    if (finalSession) {
      console.log(
        `GremlinRecorder: Stopped session ${finalSession.header.sessionId} - ` +
          `${finalSession.events.length} events, ${finalSession.elements.length} elements`
      );

      // Auto-upload if enabled (delegates to transport capability)
      if (this.transportCap.shouldUploadOnStop()) {
        this.transportCap.uploadSession(finalSession);
      }
    }

    return finalSession;
  }

  /**
   * Stop recording and upload session (async version).
   * Returns the upload result along with the session.
   * Delegates upload workflow to the transport capability.
   */
  public async stopAndUpload(): Promise<UploadResult> {
    const session = this.stopWithoutUpload();

    if (!session) {
      return { success: false, error: 'No active session to stop' };
    }

    return this.transportCap.uploadSession(session);
  }

  /**
   * Stop recording without auto-upload (for manual handling).
   */
  public stopWithoutUpload(): GremlinSession | null {
    if (!this.isRecording()) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    // Cleanup RN-specific listeners
    this.cleanupListeners();

    // BaseRecorder stops capabilities (transport batching, performance),
    // flushes batcher, sets recording=false, sets endTime
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
   * Upload a session to the configured transport.
   * Delegates to the transport capability which owns the upload workflow.
   */
  public async uploadSession(session: GremlinSession): Promise<UploadResult> {
    return this.transportCap.uploadSession(session);
  }

  public async checkServer(): Promise<boolean> {
    const transport = this.transportCap.getTransport();
    if (!transport) return false;
    return transport.checkServer();
  }

  public isActive(): boolean {
    return this.isRecording();
  }

  public getGestureInterceptor(): GestureInterceptor | null {
    return this.gestureInterceptor;
  }

  public override destroy(): void {
    this.cleanupListeners();
    // BaseRecorder.destroy() calls destroy() on all capabilities (transport, performance)
    // and cleans up performanceProvider, networkInterceptor, batcher
    super.destroy();
  }

  // ========================================================================
  // Event Recording Override
  // ========================================================================

  /**
   * Override to queue events for transport and emit to onEvent callback.
   * Performance enrichment is handled by BaseRecorder via performanceProvider.
   */
  protected override addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    // Call parent implementation (handles perf enrichment, delta timestamps, session push, debug logging)
    super.addEventToSession(event);

    // Queue event for transport batching
    const transport = this.transportCap.getTransport();
    if (transport && this.session) {
      const fullEvent = this.session.events[this.session.events.length - 1];
      if (fullEvent) {
        transport.queueEvent(fullEvent);
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

    // Note: performanceProvider and networkInterceptor cleanup handled by BaseRecorder.stop()/destroy()

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    this.teardownErrorTracking();
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
        // Cast from unknown to RNComponentRef at the RN boundary — gesture.target
        // is a React Native component instance from the touch responder system.
        const target = gesture.target as RNComponentRef;
        const interactiveElement = findInteractiveParent(target);
        const elementInfo = await captureElement(interactiveElement ?? target);
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

    // Reset performance monitor navigation timer (via base class provider)
    this.performanceProvider?.markNavigation();

    // Use BaseRecorder's recordNavigation which handles currentScreen tracking
    this.recordNavigation(change.screen, change.type);
  };

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (!this.isRecording()) return;

    // Only record known app states (ignore 'unknown', 'extension', etc.)
    const validStates = ['active', 'background', 'inactive'] as const;
    if (!(validStates as readonly string[]).includes(nextAppState)) return;

    this.recordAppState(nextAppState as 'active' | 'background' | 'inactive');
  };
}
