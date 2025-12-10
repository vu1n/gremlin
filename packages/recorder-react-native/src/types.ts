/**
 * React Native specific types for the Gremlin Recorder
 */

// Re-export core event type
import type { GremlinEvent } from '@gremlin/session';
export type { GremlinEvent };

/**
 * Transport configuration for uploading sessions
 */
export interface TransportConfig {
  /**
   * Dev server endpoint.
   * For RN on device/simulator, use your machine's IP: http://192.168.1.100:3334
   * For iOS simulator on same machine, localhost works.
   * Default: http://localhost:3334
   */
  endpoint?: string;

  /**
   * Fall back to AsyncStorage if server unavailable.
   * Requires @react-native-async-storage/async-storage.
   * Default: false
   */
  fallbackToStorage?: boolean;

  /**
   * Upload session automatically when recording stops.
   * Default: true
   */
  autoUpload?: boolean;

  /**
   * Upload events in batches during recording (for long sessions).
   * Interval in milliseconds. Set to 0 to disable.
   * Default: 30000 (30 seconds)
   */
  batchInterval?: number;

  /** Debug logging */
  debug?: boolean;
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

  /**
   * Transport config for uploading sessions.
   * Set to false to disable transport entirely (manual export only).
   */
  transport?: TransportConfig | false;

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
