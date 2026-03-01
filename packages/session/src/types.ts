/**
 * Session types - Recording format for user sessions
 *
 * Optimized for:
 * - Minimal size (delta encoding, dictionary compression)
 * - Element identification (testID, accessibility, text)
 * - Performance metrics capture
 */

export interface GremlinSession {
  header: SessionHeader;
  elements: ElementInfo[];
  /** Delta-encoded timestamps */
  events: GremlinEvent[];
  screenshots: Screenshot[];

  /** rrweb events for DOM replay (web only) */
  rrwebEvents?: unknown[];

  performance?: SessionPerformance;
}

export interface SessionHeader {
  sessionId: string;
  /** Unix ms */
  startTime: number;
  /** Unix ms */
  endTime?: number;
  device: DeviceInfo;
  app: AppInfo;
  /** For forward-compatible migrations */
  schemaVersion: number;
}

export interface DeviceInfo {
  platform: 'web' | 'ios' | 'android';
  osVersion: string;
  /** e.g., "iPhone 15", "Pixel 8" */
  model?: string;
  screen: {
    width: number;
    height: number;
    pixelRatio: number;
  };
  /** Web only */
  userAgent?: string;
  locale?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  build?: string;
  /** Bundle ID (mobile) or origin (web) */
  identifier: string;
}

/**
 * Element information for the dictionary.
 * Events reference elements by index to save space.
 */
export interface ElementInfo {
  /** Best for test generation */
  testId?: string;
  accessibilityLabel?: string;
  text?: string;
  type: ElementType;
  bounds?: Rect;
  /** Web only */
  cssSelector?: string;
  attributes?: Record<string, string>;
}

export type ElementType =
  | 'button'
  | 'link'
  | 'input'
  | 'text'
  | 'image'
  | 'container'
  | 'scroll_view'
  | 'list'
  | 'list_item'
  | 'modal'
  | 'pressable'
  | 'touchable'
  | 'unknown';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GremlinEvent {
  /** Delta time from previous event (ms) */
  dt: number;
  type: EventTypeEnum;
  data: EventData;
  /** Sampled at event time */
  perf?: PerformanceSample;
}

export enum EventTypeEnum {
  TAP = 0,
  DOUBLE_TAP = 1,
  LONG_PRESS = 2,
  SWIPE = 3,
  SCROLL = 4,
  INPUT = 5,
  NAVIGATION = 6,
  NETWORK = 7,
  SCREEN_CAPTURE = 8,
  ERROR = 9,
  APP_STATE = 10,
}

export type EventData =
  | TapEvent
  | SwipeEvent
  | ScrollEvent
  | InputEvent
  | NavigationEvent
  | NetworkEvent
  | ScreenCaptureEvent
  | ErrorEvent
  | AppStateEvent;

export interface TapEvent {
  kind: 'tap' | 'double_tap' | 'long_press';
  x: number;
  y: number;
  /** Index into session.elements dictionary */
  elementIndex?: number;
}

export interface SwipeEvent {
  kind: 'swipe';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** ms */
  duration: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

export interface ScrollEvent {
  kind: 'scroll';
  deltaX: number;
  deltaY: number;
  containerIndex?: number;
  /** Number of raw scroll events coalesced into this one (for replay fidelity) */
  coalesced?: number;
}

export interface InputEvent {
  kind: 'input';
  elementIndex?: number;
  /** May be masked for PII */
  value: string;
  masked: boolean;
  inputType?: 'text' | 'password' | 'email' | 'number' | 'phone';
}

export interface NavigationEvent {
  kind: 'navigation';
  navType: 'push' | 'pop' | 'replace' | 'reset' | 'tab' | 'modal';
  screen: string;
  /** Set by recorder, not user code */
  fromScreen?: string;
  /** May be masked for PII */
  params?: Record<string, unknown>;
  /** Web only */
  url?: string;
}

export interface NetworkEvent {
  kind: 'network';
  /** Correlates start/end/error phases of the same request */
  requestId: string;
  method: string;
  /** Query params stripped for privacy */
  url: string;
  status?: number;
  /** ms */
  duration?: number;
  phase: 'start' | 'end' | 'error';
  error?: string;
}

export interface ScreenCaptureEvent {
  kind: 'screen_capture';
  /** Index into session.screenshots */
  screenshotIndex: number;
  trigger: 'navigation' | 'interval' | 'error' | 'manual';
}

export interface ErrorEvent {
  kind: 'error';
  message: string;
  stack?: string;
  errorType: 'js' | 'native' | 'network' | 'render';
  fatal: boolean;
}

export interface AppStateEvent {
  kind: 'app_state';
  state: 'active' | 'background' | 'inactive';
}

export interface PerformanceSample {
  fps?: number;
  /** ms */
  jsThreadLag?: number;
  /** MB */
  memoryUsage?: number;
  /** ms since last navigation */
  timeSinceNavigation?: number;
  /** Since last sample */
  longTaskCount?: number;
  /** ms, since last sample */
  longTaskTotalDuration?: number;
}

/**
 * Web Vitals - session-scoped, one snapshot per page load.
 */
export interface WebVitals {
  /** ms */
  lcp?: number;
  cls?: number;
  /** ms */
  inp?: number;
  /** ms */
  fcp?: number;
  /** ms */
  ttfb?: number;
}

export interface SessionPerformance {
  /** Web only */
  webVitals?: WebVitals;
  longTaskCount?: number;
  /** ms */
  longTaskTotalDuration?: number;
  avgFps?: number;
  minFps?: number;
  /** MB */
  peakMemoryUsage?: number;
  /** ms */
  pageLoadTime?: number;
}

export interface Screenshot {
  id: string;
  /** Unix ms */
  timestamp: number;
  format: 'webp' | 'jpeg' | 'png';
  /** Base64 or URL, depending on isUrl */
  data: string;
  isUrl: boolean;
  width: number;
  height: number;
  /** 0-100 */
  quality: number;
  isDiff: boolean;
  /** Reference for reconstructing full image from diff */
  diffFromId?: string;
}

/**
 * Common return type for session upload/transport methods across all recorders.
 */
export interface UploadResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface SessionAnalytics {
  sessionId: string;
  duration: number;
  eventCount: number;
  errorCount: number;
  screens: string[];
  platform: 'web' | 'ios' | 'android';
  appName?: string;
  deviceInfo: Partial<DeviceInfo>;
  timestamp: Date;
}

// Runtime helper functions (createSession, generateSessionId, addEvent,
// getOrCreateElement) have been moved to ./builders.ts to keep this
// file focused on type contracts.
