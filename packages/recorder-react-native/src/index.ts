/**
 * @gremlin/recorder-react-native
 *
 * React Native session recorder SDK for Gremlin test generation.
 *
 * Captures user gestures, navigation, and element info to produce GremlinSession data.
 */

export const VERSION = '0.0.1';

// Main exports
export { GremlinRecorder } from './recorder';
export { GremlinProvider, useGremlin, withGremlin } from './GremlinProvider';
export { LocalTransport } from './transport';

// Types
export type { GremlinRecorderConfig, NavigationRef, TransportConfig } from './types';
export type { TransportResult } from './transport';

// Element capture utilities (for advanced usage)
export {
  captureElement,
  measureElement,
  findInteractiveParent,
  toElementInfo,
} from './element-capture';

// Gesture interceptor (for custom implementations)
export {
  GestureInterceptor,
  createGestureHandlers,
  type GestureEvent,
  type GestureType,
} from './gesture-interceptor';

// Navigation listener (for custom implementations)
export {
  NavigationListener,
  createNavigationListener,
  type NavigationChange,
  type NavigationType,
} from './navigation-listener';

// Performance monitor (for custom implementations)
export {
  PerformanceMonitor,
  createPerformanceMonitor,
} from './performance-monitor';

// Re-export core types for convenience
export type {
  GremlinSession,
  GremlinEvent,
  EventTypeEnum,
  TapEvent,
  SwipeEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  AppStateEvent,
  ErrorEvent,
  PerformanceSample,
  DeviceInfo,
  AppInfo,
  ElementInfo,
  ElementType,
} from '@gremlin/session';
