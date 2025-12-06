// GremlinSpec - State machine model
export * from './spec/types';

// Session - Recording format
// Note: Rename session ElementType to avoid collision with spec ElementType
export {
  type GremlinSession,
  type SessionHeader,
  type DeviceInfo,
  type AppInfo,
  type ElementInfo,
  type ElementType as SessionElementType,
  type Rect,
  type GremlinEvent,
  EventTypeEnum,
  type EventData,
  type TapEvent,
  type SwipeEvent,
  type ScrollEvent,
  type InputEvent,
  type NavigationEvent,
  type NetworkEvent,
  type ScreenCaptureEvent,
  type ErrorEvent,
  type AppStateEvent,
  type PerformanceSample,
  type Screenshot,
  createSession,
  getOrCreateElement,
  addEvent,
} from './session/types';
export * from './session/optimizer';

// Importers - Import sessions from various platforms
export * from './importers/index';

// Test Generators
export * from './generators/index';

// AI Analysis
export * from './ai/index';
