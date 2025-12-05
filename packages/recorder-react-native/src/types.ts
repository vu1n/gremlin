/**
 * React Native specific types for the Gremlin Recorder
 */

// Local event type definition (will be unified with @gremlin/core later)
export interface GremlinEvent {
  type: string;
  timestamp: number;
  testID?: string;
  screen?: string;
  data?: Record<string, any>;
}

/**
 * Configuration for the React Native recorder
 */
export interface GremlinRecorderConfig {
  /** App name */
  appName: string;

  /** App version */
  appVersion: string;

  /** Build number */
  appBuild?: string;

  /** Auto-start recording on mount */
  autoStart?: boolean;

  /** Sample performance metrics */
  capturePerformance?: boolean;

  /** Performance sample interval (ms) */
  performanceInterval?: number;

  /** Mask sensitive inputs */
  maskInputs?: boolean;

  /** Emit events to callback (for real-time streaming) */
  onEvent?: (event: GremlinEvent) => void;

  /** Enable gesture interception */
  captureGestures?: boolean;

  /** Enable navigation tracking */
  captureNavigation?: boolean;

  /** Minimum swipe distance (px) */
  minSwipeDistance?: number;

  /** Long press duration (ms) */
  longPressDuration?: number;

  /** Double tap max delay (ms) */
  doubleTapDelay?: number;

  /** Debounce scroll events (ms) */
  scrollDebounce?: number;
}

/**
 * Touch tracking data
 */
export interface TouchData {
  identifier: number;
  pageX: number;
  pageY: number;
  timestamp: number;
  target?: any;
}

/**
 * React Navigation reference type (if available)
 */
export interface NavigationRef {
  addListener: (event: string, callback: (...args: any[]) => void) => () => void;
  getCurrentRoute: () => { name: string; params?: any } | undefined;
}

/**
 * View measurement result
 */
export interface ViewMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

/**
 * Element info extracted from React Native view
 */
export interface ExtractedElementInfo {
  testID?: string;
  accessibilityLabel?: string;
  text?: string;
  type: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
