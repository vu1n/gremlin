/**
 * @gremlin/session - Lightweight session recording for client-side SDKs
 *
 * This package contains:
 * - Session types (GremlinSession, events, elements)
 * - Event batching (scroll coalescing)
 * - Base recorder class (platform-agnostic)
 * - Transport adapters (local dev server, cloud, S3)
 *
 * NO heavy dependencies - safe for client-side bundling.
 */

export const VERSION = '0.0.1';

// Session types
export type {
  GremlinSession,
  SessionHeader,
  DeviceInfo,
  AppInfo,
  ElementInfo,
  ElementType,
  Rect,
  GremlinEvent,
  EventData,
  TapEvent,
  SwipeEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  NetworkEvent,
  ScreenCaptureEvent,
  ErrorEvent,
  AppStateEvent,
  PerformanceSample,
  Screenshot,
  SessionAnalytics,
} from './types';
export { EventTypeEnum, createSession, getOrCreateElement, addEvent } from './types';

// Event batching
export type { ScrollBatch, BatcherConfig, BatcherCallbacks } from './batcher';
export { EventBatcher } from './batcher';

// Base recorder
export type { BaseRecorderConfig, SessionMetadata } from './recorder-base';
export { BaseRecorder } from './recorder-base';

// Transport
export * from './transport/index';
