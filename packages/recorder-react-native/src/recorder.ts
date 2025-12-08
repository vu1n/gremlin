/**
 * GremlinRecorder - React Native session recorder
 *
 * Captures user gestures, navigation, and element info to produce GremlinSession data.
 */

import { Platform, Dimensions, AppState, type AppStateStatus, NativeModules } from 'react-native';
import type {
  GremlinSession,
  GremlinEvent,
  EventTypeEnum,
  TapEvent,
  SwipeEvent,
  ScrollEvent,
  NavigationEvent,
  AppStateEvent,
  ErrorEvent,
  DeviceInfo,
  AppInfo,
  PerformanceSample,
} from '@gremlin/session';
import { createSession, getOrCreateElement, addEvent } from '@gremlin/session';
import { GestureInterceptor, type GestureEvent } from './gesture-interceptor';
import { NavigationListener, type NavigationChange } from './navigation-listener';
import { PerformanceMonitor } from './performance-monitor';
import { captureElement, toElementInfo, findInteractiveParent } from './element-capture';
import type { GremlinRecorderConfig, NavigationRef } from './types';

/**
 * Main recorder class for React Native
 */
export class GremlinRecorder {
  private config: Required<
    Omit<GremlinRecorderConfig, 'appBuild' | 'onEvent' | 'navigationRef'>
  > & {
    appBuild?: string;
    onEvent?: (event: GremlinEvent) => void;
  };

  private session: GremlinSession | null = null;
  private isRecording = false;
  private lastEventTimestamp = 0;

  // Sub-modules
  private gestureInterceptor: GestureInterceptor | null = null;
  private navigationListener: NavigationListener | null = null;
  private performanceMonitor: PerformanceMonitor | null = null;

  // App state tracking
  private appStateSubscription: any = null;

  // Error tracking
  private errorHandler: ((error: Error) => void) | null = null;

  // Scroll tracking
  private scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScrollPosition = { x: 0, y: 0 };

  constructor(config: GremlinRecorderConfig) {
    this.config = {
      appName: config.appName,
      appVersion: config.appVersion,
      appBuild: config.appBuild,
      autoStart: config.autoStart ?? false,
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
    };
  }

  /**
   * Start recording session
   */
  public start(navigationRef?: NavigationRef): void {
    if (this.isRecording) {
      console.warn('GremlinRecorder: Already recording');
      return;
    }

    // Create session
    this.session = createSession(this.getDeviceInfo(), this.getAppInfo());
    this.lastEventTimestamp = this.session.header.startTime;
    this.isRecording = true;

    // Setup gesture interception
    if (this.config.captureGestures) {
      this.setupGestureInterceptor();
    }

    // Setup navigation listener
    if (this.config.captureNavigation && navigationRef) {
      this.setupNavigationListener(navigationRef);
    }

    // Setup performance monitor
    if (this.config.capturePerformance) {
      this.setupPerformanceMonitor();
    }

    // Setup app state listener
    this.setupAppStateListener();

    // Setup error tracking
    this.setupErrorTracking();

    console.log(`GremlinRecorder: Started session ${this.session.header.sessionId}`);
  }

  /**
   * Stop recording and return session
   */
  public stop(): GremlinSession | null {
    if (!this.isRecording || !this.session) {
      console.warn('GremlinRecorder: Not recording');
      return null;
    }

    this.isRecording = false;

    // Cleanup gesture interceptor
    if (this.gestureInterceptor) {
      this.gestureInterceptor.cleanup();
      this.gestureInterceptor = null;
    }

    // Cleanup navigation listener
    if (this.navigationListener) {
      this.navigationListener.stop();
      this.navigationListener = null;
    }

    // Cleanup performance monitor
    if (this.performanceMonitor) {
      this.performanceMonitor.stop();
      this.performanceMonitor = null;
    }

    // Cleanup app state listener
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // Clear scroll timer
    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
      this.scrollDebounceTimer = null;
    }

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
   * Get current session (without stopping)
   */
  public getSession(): GremlinSession | null {
    return this.session;
  }

  /**
   * Check if currently recording
   */
  public isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Get gesture interceptor (for use with GremlinProvider)
   */
  public getGestureInterceptor(): GestureInterceptor | null {
    return this.gestureInterceptor;
  }

  /**
   * Record a scroll event manually
   */
  public recordScroll(x: number, y: number, containerIndex?: number): void {
    if (!this.session) return;

    // Debounce scroll events
    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
    }

    this.lastScrollPosition = { x, y };

    this.scrollDebounceTimer = setTimeout(() => {
      this.recordScrollEvent(
        this.lastScrollPosition.x,
        this.lastScrollPosition.y,
        containerIndex
      );
    }, this.config.scrollDebounce);
  }

  // ========================================================================
  // Private Methods - Setup
  // ========================================================================

  private getDeviceInfo(): DeviceInfo {
    const { width, height } = Dimensions.get('window');
    const scale = Dimensions.get('window').scale;

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

  private getAppInfo(): AppInfo {
    return {
      name: this.config.appName,
      version: this.config.appVersion,
      build: this.config.appBuild,
      identifier: this.getBundleId(),
    };
  }

  private getDeviceModel(): string | undefined {
    try {
      // Try to get from native modules
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
      minSwipeDistance: this.config.minSwipeDistance,
      longPressDuration: this.config.longPressDuration,
      doubleTapDelay: this.config.doubleTapDelay,
    });
  }

  private setupNavigationListener(navigationRef: NavigationRef): void {
    this.navigationListener = new NavigationListener({
      onNavigationChange: this.handleNavigationChange,
      navigationRef,
      maskParams: this.config.maskInputs,
    });

    this.navigationListener.start(navigationRef);
  }

  private setupPerformanceMonitor(): void {
    this.performanceMonitor = new PerformanceMonitor({
      sampleInterval: this.config.performanceInterval,
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
    // Note: React Native error handling is complex and typically done at app level
    // This is a basic implementation - production apps should use error boundaries
    // and custom error reporting services

    this.errorHandler = (error: Error) => {
      if (!this.session) return;

      const errorEvent: Omit<GremlinEvent, 'dt'> = {
        type: 9 as EventTypeEnum.ERROR,
        data: {
          kind: 'error',
          message: error.message,
          stack: error.stack,
          errorType: 'js',
          fatal: false,
        } as ErrorEvent,
      };

      this.addEventToSession(errorEvent);
    };

    // This would be set up at the app level with ErrorUtils or custom error boundary
  }

  // ========================================================================
  // Private Methods - Event Handlers
  // ========================================================================

  private handleGesture = async (gesture: GestureEvent): Promise<void> => {
    if (!this.session) return;

    try {
      // Find interactive element if target is available
      let elementIndex: number | undefined;
      if (gesture.target) {
        const interactiveElement = findInteractiveParent(gesture.target);
        const elementInfo = await captureElement(interactiveElement || gesture.target);
        if (elementInfo) {
          elementIndex = getOrCreateElement(this.session, toElementInfo(elementInfo));
        }
      }

      // Create event based on gesture type
      if (gesture.type === 'swipe') {
        const swipeEvent: Omit<GremlinEvent, 'dt'> = {
          type: 3 as EventTypeEnum.SWIPE,
          data: {
            kind: 'swipe',
            startX: gesture.startX!,
            startY: gesture.startY!,
            endX: gesture.endX!,
            endY: gesture.endY!,
            duration: gesture.duration!,
            direction: gesture.direction!,
          } as SwipeEvent,
          perf: this.capturePerformance(),
        };
        this.addEventToSession(swipeEvent);
      } else {
        // Tap, double_tap, long_press
        const tapEvent: Omit<GremlinEvent, 'dt'> = {
          type: gesture.type === 'double_tap'
            ? (1 as EventTypeEnum.DOUBLE_TAP)
            : gesture.type === 'long_press'
            ? (2 as EventTypeEnum.LONG_PRESS)
            : (0 as EventTypeEnum.TAP),
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
          perf: this.capturePerformance(),
        };
        this.addEventToSession(tapEvent);
      }
    } catch (error) {
      console.warn('Failed to handle gesture:', error);
    }
  };

  private handleNavigationChange = (change: NavigationChange): void => {
    if (!this.session) return;

    // Reset performance monitor navigation timer
    if (this.performanceMonitor) {
      this.performanceMonitor.markNavigation();
    }

    const navEvent: Omit<GremlinEvent, 'dt'> = {
      type: 6 as EventTypeEnum.NAVIGATION,
      data: {
        kind: 'navigation',
        navType: change.type,
        screen: change.screen,
        params: change.params,
      } as NavigationEvent,
      perf: this.capturePerformance(),
    };

    this.addEventToSession(navEvent);
  };

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (!this.session) return;

    const appStateEvent: Omit<GremlinEvent, 'dt'> = {
      type: 10 as EventTypeEnum.APP_STATE,
      data: {
        kind: 'app_state',
        state: nextAppState as 'active' | 'background' | 'inactive',
      } as AppStateEvent,
    };

    this.addEventToSession(appStateEvent);
  };

  private recordScrollEvent(x: number, y: number, containerIndex?: number): void {
    if (!this.session) return;

    const scrollEvent: Omit<GremlinEvent, 'dt'> = {
      type: 4 as EventTypeEnum.SCROLL,
      data: {
        kind: 'scroll',
        deltaX: Math.round(x),
        deltaY: Math.round(y),
        containerIndex,
      } as ScrollEvent,
    };

    this.addEventToSession(scrollEvent);
  }

  // ========================================================================
  // Private Methods - Performance & Event Management
  // ========================================================================

  private capturePerformance(): PerformanceSample | undefined {
    if (!this.config.capturePerformance || !this.performanceMonitor) {
      return undefined;
    }

    return this.performanceMonitor.getCurrentSample();
  }

  private addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    if (!this.session) return;

    this.lastEventTimestamp = addEvent(this.session, event, this.lastEventTimestamp);

    // Emit to callback if configured
    if (this.config.onEvent) {
      const fullEvent = this.session.events[this.session.events.length - 1];
      this.config.onEvent(fullEvent);
    }
  }
}
