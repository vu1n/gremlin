/**
 * @gremlin/recorder-web - Web session recorder and replayer
 *
 * Records user sessions in the browser using rrweb and enriches events
 * with element identification for test generation.
 *
 * Also provides session replay functionality via rrweb-player.
 */

export const VERSION = '0.0.1';

// Recorder
export { GremlinRecorder, type RecorderConfig } from './recorder.ts';
export { captureElement, findInteractiveElement } from './element-capture.ts';
export { WebPerformanceMonitor, type WebPerformanceMonitorConfig } from './performance-monitor.ts';
export {
  TransportCapability,
  PerformanceCapability,
  type TransportCapabilityConfig,
  type PerformanceCapabilityConfig,
} from './capabilities.ts';

// Replayer
export {
  GremlinReplayer,
  createReplayViewer,
  type ReplayerConfig,
  type RrwebSession,
} from './replayer.ts';
