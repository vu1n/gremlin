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

// --- Constants ---
export { SCHEMA_VERSION, SDK_VERSION } from './constants.ts';
/** @deprecated Use SDK_VERSION instead */
export { SDK_VERSION as VERSION } from './constants.ts';

// --- Contracts (types, interfaces, enums) ---
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
  WebVitals,
  SessionPerformance,
  Screenshot,
  SessionAnalytics,
  UploadResult,
} from './types.ts';
export { EventTypeEnum } from './types.ts';

// --- Runtime helpers (session creation & mutation) ---
export { createSession, getOrCreateElement, addEvent, generateSessionId } from './builders.ts';

// --- Event batching ---
export type { ScrollBatch, BatcherConfig, BatcherCallbacks } from './batcher.ts';
export { EventBatcher } from './batcher.ts';

// --- Base recorder (platform-agnostic) ---
export type { BaseRecorderConfig, SessionMetadata, PerformanceProvider, RecorderCapability } from './recorder-base.ts';
export { BaseRecorder } from './recorder-base.ts';

// --- Network interceptor (shared between web and RN recorders) ---
export type { NetworkInterceptorConfig } from './network-interceptor.ts';
export { NetworkInterceptor, sanitizeUrl, shouldIgnoreUrl } from './network-interceptor.ts';

// --- Transport ---
export * from './transport/index.ts';
