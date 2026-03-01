/**
 * React Native specific types for the Gremlin Recorder
 */

// Re-export core event type
import type { GremlinEvent } from '@gremlin/session';
export type { GremlinEvent };

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

  debug?: boolean;
}

export interface GremlinRecorderConfig {
  appName: string;
  appVersion: string;
  appBuild?: string;

  autoStart?: boolean;

  /**
   * Transport config for uploading sessions.
   * Set to false to disable transport entirely (manual export only).
   */
  transport?: TransportConfig | false;

  capturePerformance?: boolean;
  /** ms */
  performanceInterval?: number;
  maskInputs?: boolean;

  /** Emit events to callback (for real-time streaming) */
  onEvent?: (event: GremlinEvent) => void;

  captureGestures?: boolean;
  captureNavigation?: boolean;
  /** px */
  minSwipeDistance?: number;
  /** ms */
  longPressDuration?: number;
  /** ms */
  doubleTapDelay?: number;
  /** ms */
  scrollDebounce?: number;

  /** Capture network requests (fetch and XHR) (default: true) */
  captureNetwork?: boolean;

  /** URL patterns to ignore for network capture (substring match) */
  networkIgnorePatterns?: string[];
}

export interface TouchData {
  identifier: number;
  pageX: number;
  pageY: number;
  timestamp: number;
  /** React Native touch event target (opaque native ref) */
  target?: unknown;
}

/** Minimal structural type for React Navigation's NavigationContainerRef. */
export interface NavigationRef {
  addListener: (event: string, callback: (...args: unknown[]) => void) => () => void;
  getCurrentRoute: () => { name: string; params?: Record<string, unknown> } | undefined;
}

export interface ViewMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

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
