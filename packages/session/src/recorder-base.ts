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
  PerformanceSample,
} from './types.ts';
import { EventTypeEnum } from './types.ts';
import { generateSessionId } from './builders.ts';
import { SCHEMA_VERSION } from './constants.ts';
import { EventBatcher } from './batcher.ts';
import { NetworkInterceptor, type NetworkInterceptorConfig } from './network-interceptor.ts';

/**
 * A self-contained lifecycle unit that can be registered with BaseRecorder.
 * Each capability encapsulates a single concern (transport, performance, etc.)
 * and receives start/stop/destroy calls from the recorder lifecycle.
 */
export interface RecorderCapability {
  /** Human-readable name for debug logging (e.g. 'transport', 'performance'). */
  readonly name: string;
  /** Called when the recorder starts a new session. */
  start(): void;
  /** Called when the recorder stops (in reverse registration order). */
  stop(): void;
  /** Called when the recorder is destroyed (in reverse registration order). */
  destroy(): void;
}

// Debug logger — no-op unless config.debug is true
type LogFn = (msg: string, ...args: unknown[]) => void;

function createLogger(debug: boolean): LogFn {
  if (!debug) return () => {};
  return (msg, ...args) => console.log(`[Gremlin] ${msg}`, ...args);
}

/**
 * Platform-agnostic interface for performance monitors.
 * Both web and RN performance monitors implement these methods,
 * allowing BaseRecorder to handle perf enrichment and lifecycle.
 */
export interface PerformanceProvider {
  getCurrentSample(): PerformanceSample;
  markNavigation(): void;
  start(): void;
  stop(): void;
}

export interface BaseRecorderConfig {
  /** Default: true */
  enableBatching?: boolean;
  /** ms, default: 150 */
  scrollBatchWindow?: number;
  debug?: boolean;
}

export interface SessionMetadata {
  device: DeviceInfo;
  app: AppInfo;
  custom?: Record<string, unknown>;
}

export abstract class BaseRecorder {
  protected session: GremlinSession | null = null;
  protected recording: boolean = false;
  protected currentScreen: string = 'unknown';
  protected lastEventTimestamp: number = 0;
  protected elementMap: Map<string, number> = new Map();
  protected unknownElementCounter = 0;
  protected config: Required<BaseRecorderConfig>;
  protected log: LogFn;
  protected batcher: EventBatcher;

  /**
   * Optional performance provider. When set, every event is automatically
   * enriched with a perf sample, and the provider is stopped/cleaned up
   * in stop() and destroy().
   */
  protected performanceProvider: PerformanceProvider | null = null;

  /**
   * Optional network interceptor. When set, it is uninstalled and cleaned
   * up in stop() and destroy().
   */
  protected networkInterceptor: NetworkInterceptor | null = null;

  /**
   * Registered capabilities. Capabilities are started in registration order
   * and stopped/destroyed in reverse order.
   */
  private capabilities: RecorderCapability[] = [];

  constructor(config: BaseRecorderConfig = {}) {
    this.config = {
      enableBatching: config.enableBatching ?? true,
      scrollBatchWindow: config.scrollBatchWindow ?? 150,
      debug: config.debug ?? false,
    };
    this.log = createLogger(this.config.debug);

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

  /**
   * Register a capability to participate in the recorder lifecycle.
   * Capabilities are started in registration order and stopped/destroyed
   * in reverse order (LIFO).
   */
  protected registerCapability(capability: RecorderCapability): void {
    this.capabilities.push(capability);
    this.log(`Capability registered: ${capability.name}`);
  }

  protected abstract getDeviceInfo(): DeviceInfo;
  protected abstract getAppInfo(): AppInfo;

  protected generateSessionId(): string {
    return generateSessionId();
  }

  start(): void {
    const now = Date.now();

    this.session = {
      header: {
        sessionId: this.generateSessionId(),
        startTime: now,
        device: this.getDeviceInfo(),
        app: this.getAppInfo(),
        schemaVersion: SCHEMA_VERSION,
      },
      elements: [],
      events: [],
      screenshots: [],
    };

    this.recording = true;
    this.lastEventTimestamp = now;
    this.elementMap.clear();
    this.unknownElementCounter = 0;

    // Start all registered capabilities (in registration order)
    for (const cap of this.capabilities) {
      cap.start();
    }

    this.log('Recording started', {
      sessionId: this.session.header.sessionId,
    });
  }

  /** Flushes any pending batched events before stopping. */
  stop(): GremlinSession | null {
    if (!this.session) return null;

    // Stop registered capabilities in reverse order (LIFO)
    for (let i = this.capabilities.length - 1; i >= 0; i--) {
      this.capabilities[i].stop();
    }

    // Stop performance provider before flushing (subclasses may read session-level data first)
    if (this.performanceProvider) {
      this.performanceProvider.stop();
      this.performanceProvider = null;
    }

    // Uninstall network interceptor
    if (this.networkInterceptor) {
      this.networkInterceptor.uninstall();
      this.networkInterceptor = null;
    }

    // Flush pending scroll batch before stopping
    this.batcher.flush();

    this.recording = false;
    this.session.header.endTime = Date.now();

    this.log('Recording stopped', {
      events: this.session.events.length,
      elements: this.session.elements.length,
    });

    return this.getSession();
  }

  /** Call on lifecycle events (background, visibility hidden) to avoid data loss. */
  flush(): void {
    this.batcher.flush();
  }

  destroy(): void {
    // Destroy registered capabilities in reverse order (LIFO)
    for (let i = this.capabilities.length - 1; i >= 0; i--) {
      this.capabilities[i].destroy();
    }
    this.capabilities = [];

    if (this.performanceProvider) {
      this.performanceProvider.stop();
      this.performanceProvider = null;
    }
    if (this.networkInterceptor) {
      this.networkInterceptor.uninstall();
      this.networkInterceptor = null;
    }
    this.batcher.destroy();
    this.session = null;
    this.recording = false;
  }

  /**
   * Restore internal state from a previously persisted session.
   * Used by platform recorders (e.g., web persistence across page loads).
   */
  protected restoreState(state: {
    session: GremlinSession;
    recording: boolean;
    lastEventTimestamp: number;
    elementMap: Map<string, number>;
    unknownElementCounter: number;
  }): void {
    this.session = state.session;
    this.recording = state.recording;
    this.lastEventTimestamp = state.lastEventTimestamp;
    this.elementMap = state.elementMap;
    this.unknownElementCounter = state.unknownElementCounter;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getSession(): GremlinSession | null {
    if (!this.session) return null;

    // During recording, return session directly to avoid copying on every call.
    // endTime is set in stop() — callers needing a snapshot should use exportJson().
    return this.session;
  }

  getEventCount(): number {
    return this.session?.events.length ?? 0;
  }

  protected addEventToSession(event: Omit<GremlinEvent, 'dt'>): void {
    if (!this.recording || !this.session) return;

    // Auto-attach perf sample if provider is active and event doesn't already have one
    let enrichedEvent = event;
    if (this.performanceProvider && !event.perf) {
      enrichedEvent = { ...event, perf: this.performanceProvider.getCurrentSample() };
    }

    const now = Date.now();
    const dt = now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    const fullEvent: GremlinEvent = {
      ...enrichedEvent,
      dt,
    };

    this.session.events.push(fullEvent);

    this.log(`Event: ${EventTypeEnum[enrichedEvent.type]}`, { dt, data: enrichedEvent.data });
  }

  /**
   * Get or create element in dictionary, return index.
   * Elements are deduplicated by testId/accessibilityLabel/text.
   */
  protected getOrCreateElement(info: Partial<ElementInfo>): number {
    if (!this.session) return -1;

    const hasIdentifier = !!(info.testId || info.accessibilityLabel || info.text);
    const key = info.testId || info.accessibilityLabel || info.text || `_unknown_${this.unknownElementCounter}`;

    if (this.elementMap.has(key)) {
      return this.elementMap.get(key)!;
    }

    // Only increment counter after confirming this is a genuinely new unknown element
    if (!hasIdentifier) {
      this.unknownElementCounter++;
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

  /**
   * Install a network interceptor with the given config.
   * Resets the request counter and patches fetch/XHR.
   * The interceptor is automatically uninstalled in stop() and destroy().
   */
  protected installNetworkInterceptor(config: NetworkInterceptorConfig): void {
    this.networkInterceptor = new NetworkInterceptor(config);
    this.networkInterceptor.resetCounter();
    this.networkInterceptor.install();
  }

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

  recordNavigation(
    screen: string,
    navType: NavigationEvent['navType'] = 'push',
    params?: Record<string, unknown>,
    url?: string
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
        url,
      },
    });

    this.currentScreen = screen;
  }

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

  /** Also flushes scroll batch when going to background/inactive. */
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

  getTapsToScreen(screenName: string): number | null {
    if (!this.session) return null;

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
    return null;
  }

  getNavigationFlow(): string[] {
    if (!this.session) return [];

    return this.session.events
      .filter((e) => e.type === EventTypeEnum.NAVIGATION)
      .map((e) => (e.data as NavigationEvent).screen);
  }
}
