/**
 * Session types - Recording format for user sessions
 *
 * Optimized for:
 * - Minimal size (delta encoding, dictionary compression)
 * - Element identification (testID, accessibility, text)
 * - Performance metrics capture
 */

// ============================================================================
// Session
// ============================================================================

/**
 * A recorded user session.
 */
export interface GremlinSession {
  /** Session header (metadata, sent once) */
  header: SessionHeader;

  /** Element dictionary for deduplication */
  elements: ElementInfo[];

  /** Recorded events (delta-encoded) */
  events: GremlinEvent[];

  /** Captured screenshots */
  screenshots: Screenshot[];

  /** rrweb events for DOM replay (web only) */
  rrwebEvents?: unknown[];
}

export interface SessionHeader {
  /** Unique session ID */
  sessionId: string;

  /** Session start time (Unix ms) */
  startTime: number;

  /** Session end time (Unix ms) */
  endTime?: number;

  /** Device information */
  device: DeviceInfo;

  /** App information */
  app: AppInfo;

  /** Schema version for migrations */
  schemaVersion: number;
}

export interface DeviceInfo {
  /** Platform */
  platform: 'web' | 'ios' | 'android';

  /** OS version */
  osVersion: string;

  /** Device model (e.g., "iPhone 15", "Pixel 8") */
  model?: string;

  /** Screen dimensions */
  screen: {
    width: number;
    height: number;
    pixelRatio: number;
  };

  /** User agent (web) */
  userAgent?: string;

  /** Locale */
  locale?: string;
}

export interface AppInfo {
  /** App name */
  name: string;

  /** App version */
  version: string;

  /** Build number */
  build?: string;

  /** Bundle ID (mobile) or origin (web) */
  identifier: string;
}

// ============================================================================
// Elements (Dictionary)
// ============================================================================

/**
 * Element information for the dictionary.
 * Events reference elements by index to save space.
 */
export interface ElementInfo {
  /** Test ID (best for test generation) */
  testId?: string;

  /** Accessibility label */
  accessibilityLabel?: string;

  /** Visible text content */
  text?: string;

  /** Element type */
  type: ElementType;

  /** Bounding rectangle */
  bounds?: Rect;

  /** CSS selector (web only) */
  cssSelector?: string;

  /** Additional attributes */
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

// ============================================================================
// Events
// ============================================================================

/**
 * A recorded event with delta-encoded timestamp.
 */
export interface GremlinEvent {
  /** Delta time from previous event (ms) */
  dt: number;

  /** Event type */
  type: EventTypeEnum;

  /** Event-specific data */
  data: EventData;

  /** Performance sample at event time */
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

// ============================================================================
// Event Types
// ============================================================================

export interface TapEvent {
  kind: 'tap' | 'double_tap' | 'long_press';
  /** Coordinates */
  x: number;
  y: number;
  /** Element index in dictionary (if identified) */
  elementIndex?: number;
}

export interface SwipeEvent {
  kind: 'swipe';
  /** Start coordinates */
  startX: number;
  startY: number;
  /** End coordinates */
  endX: number;
  endY: number;
  /** Duration of swipe (ms) */
  duration: number;
  /** Direction */
  direction: 'up' | 'down' | 'left' | 'right';
}

export interface ScrollEvent {
  kind: 'scroll';
  /** Scroll position delta */
  deltaX: number;
  deltaY: number;
  /** Container element index */
  containerIndex?: number;
  /** Number of raw scroll events coalesced into this one (for replay hints) */
  coalesced?: number;
}

export interface InputEvent {
  kind: 'input';
  /** Element index */
  elementIndex?: number;
  /** Input value (may be masked for PII) */
  value: string;
  /** Whether value was masked */
  masked: boolean;
  /** Input type */
  inputType?: 'text' | 'password' | 'email' | 'number' | 'phone';
}

export interface NavigationEvent {
  kind: 'navigation';
  /** Navigation type */
  navType: 'push' | 'pop' | 'replace' | 'reset' | 'tab' | 'modal';
  /** Screen/route name */
  screen: string;
  /** Route parameters (may be masked) */
  params?: Record<string, unknown>;
  /** URL (web) */
  url?: string;
}

export interface NetworkEvent {
  kind: 'network';
  /** Request ID for correlation */
  requestId: string;
  /** HTTP method */
  method: string;
  /** URL (may be truncated) */
  url: string;
  /** Response status */
  status?: number;
  /** Duration (ms) */
  duration?: number;
  /** Request phase */
  phase: 'start' | 'end' | 'error';
  /** Error message if failed */
  error?: string;
}

export interface ScreenCaptureEvent {
  kind: 'screen_capture';
  /** Screenshot index */
  screenshotIndex: number;
  /** Trigger reason */
  trigger: 'navigation' | 'interval' | 'error' | 'manual';
}

export interface ErrorEvent {
  kind: 'error';
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Error type */
  errorType: 'js' | 'native' | 'network' | 'render';
  /** Whether fatal */
  fatal: boolean;
}

export interface AppStateEvent {
  kind: 'app_state';
  /** New state */
  state: 'active' | 'background' | 'inactive';
}

// ============================================================================
// Performance
// ============================================================================

export interface PerformanceSample {
  /** Frames per second */
  fps?: number;

  /** JS thread blocked time (ms) */
  jsThreadLag?: number;

  /** Memory usage (MB) */
  memoryUsage?: number;

  /** Time since last navigation (ms) */
  timeSinceNavigation?: number;
}

// ============================================================================
// Screenshots
// ============================================================================

export interface Screenshot {
  /** Unique ID */
  id: string;

  /** Capture timestamp (Unix ms) */
  timestamp: number;

  /** Image format */
  format: 'webp' | 'jpeg' | 'png';

  /** Image data (base64 or URL) */
  data: string;

  /** Whether data is a URL or inline base64 */
  isUrl: boolean;

  /** Image dimensions */
  width: number;
  height: number;

  /** Quality (0-100) */
  quality: number;

  /** Whether this is a diff from previous screenshot */
  isDiff: boolean;

  /** Previous screenshot ID if this is a diff */
  diffFromId?: string;
}

// ============================================================================
// Analytics
// ============================================================================

/**
 * Session analytics metadata for logging and future dashboard.
 */
export interface SessionAnalytics {
  sessionId: string;
  duration: number;
  eventCount: number;
  errorCount: number;
  screens: string[];
  platform: 'web' | 'ios' | 'android';
  deviceInfo: Partial<DeviceInfo>;
  timestamp: Date;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createSession(
  device: DeviceInfo,
  app: AppInfo
): GremlinSession {
  return {
    header: {
      sessionId: generateSessionId(),
      startTime: Date.now(),
      device,
      app,
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
  };
}

function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Get or create element in dictionary, return index.
 */
export function getOrCreateElement(
  session: GremlinSession,
  element: Omit<ElementInfo, 'bounds'>
): number {
  // Check if element already exists
  const existing = session.elements.findIndex(
    (e) =>
      e.testId === element.testId &&
      e.accessibilityLabel === element.accessibilityLabel &&
      e.text === element.text &&
      e.type === element.type
  );

  if (existing !== -1) {
    return existing;
  }

  // Add new element
  session.elements.push(element as ElementInfo);
  return session.elements.length - 1;
}

/**
 * Add event with delta encoding.
 */
export function addEvent(
  session: GremlinSession,
  event: Omit<GremlinEvent, 'dt'>,
  previousTimestamp: number
): number {
  const timestamp = Date.now();
  const dt = timestamp - previousTimestamp;

  session.events.push({
    ...event,
    dt,
  });

  return timestamp;
}
