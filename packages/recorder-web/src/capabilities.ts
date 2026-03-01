/**
 * Web Recorder Capabilities
 *
 * Self-contained lifecycle units that encapsulate distinct concerns
 * (transport, performance) for the web recorder. Each capability
 * implements RecorderCapability and is registered with BaseRecorder
 * to receive start/stop/destroy calls automatically.
 */

import type { GremlinSession, RecorderCapability, UploadResult } from '@gremlin/session';
import {
  LocalTransport,
  type LocalTransportConfig,
  StreamingTransport,
  type StreamingTransportConfig,
} from '@gremlin/session';
import { WebPerformanceMonitor } from './performance-monitor.ts';

// ============================================================================
// Transport Capability
// ============================================================================

export interface TransportCapabilityConfig {
  /** Transport config. 'local' or object for local transport, false to disable. */
  transport?: 'local' | LocalTransportConfig | false;
  /** Enable streaming mode. */
  streaming?: boolean | StreamingTransportConfig;
  /** Auto-upload session when stopped (default: true when transport enabled). */
  autoUpload?: boolean;
  debug?: boolean;
}

/**
 * Manages LocalTransport and StreamingTransport lifecycle.
 * Encapsulates transport initialization, streaming start/stop,
 * and auto-upload on session stop.
 */
export class TransportCapability implements RecorderCapability {
  readonly name = 'transport';

  private transport: LocalTransport | null = null;
  private streamingTransport: StreamingTransport | null = null;
  private autoUpload: boolean;
  private getSession: () => GremlinSession | null;

  constructor(config: TransportCapabilityConfig, getSession: () => GremlinSession | null) {
    this.getSession = getSession;

    const transportEnabled = config.transport !== false;
    const transportConfig =
      config.transport === 'local' || config.transport === undefined
        ? {}
        : config.transport;

    this.autoUpload = config.autoUpload ?? transportEnabled;

    // Initialize local transport
    if (transportEnabled && typeof transportConfig === 'object') {
      this.transport = new LocalTransport(transportConfig);
    }

    // Initialize streaming transport if enabled
    if (config.streaming) {
      const streamingConfig = typeof config.streaming === 'object' ? config.streaming : {};
      this.streamingTransport = new StreamingTransport({
        endpoint: this.transport ? this.transport.getEndpoint() : undefined,
        debug: config.debug,
        ...streamingConfig,
      });
    }
  }

  start(): void {
    const session = this.getSession();
    if (this.streamingTransport && session) {
      this.streamingTransport.start(session.header.sessionId);
    }
  }

  stop(): void {
    // Stop streaming AFTER batcher flush so all events are included
    if (this.streamingTransport) {
      this.streamingTransport.stop();
    }
  }

  destroy(): void {
    if (this.streamingTransport) {
      this.streamingTransport.stop();
      this.streamingTransport = null;
    }
    this.transport = null;
  }

  /** Get the local transport instance (for upload calls). */
  getTransport(): LocalTransport | null {
    return this.transport;
  }

  /** Get the streaming transport instance (for event pushing). */
  getStreamingTransport(): StreamingTransport | null {
    return this.streamingTransport;
  }

  /** Whether auto-upload is enabled. */
  isAutoUpload(): boolean {
    return this.autoUpload;
  }

  /** Whether streaming is active. */
  isStreaming(): boolean {
    return this.streamingTransport !== null;
  }

  /**
   * Whether auto-upload should fire on stop.
   * True when autoUpload is enabled, transport exists, and not streaming
   * (streaming sessions are already sent in real-time).
   */
  shouldUploadOnStop(): boolean {
    return this.autoUpload && this.transport !== null && !this.isStreaming();
  }

  /**
   * Upload a session via the local transport.
   * Encapsulates the full upload workflow: null-checks, rrweb snapshot
   * assembly, transport call, and success/failure logging.
   */
  async uploadSession(session?: GremlinSession, rrwebEvents?: unknown[]): Promise<UploadResult> {
    if (!this.transport) {
      console.warn('GremlinRecorder: No transport configured');
      return { success: false, error: 'No transport configured' };
    }

    const sessionToUpload = session || this.getSession();
    if (!sessionToUpload) {
      console.warn('GremlinRecorder: No session to upload');
      return { success: false, error: 'No session to upload' };
    }

    // Attach rrweb events if provided and not already on the session
    const fullSession: GremlinSession = rrwebEvents
      ? { ...sessionToUpload, rrwebEvents: sessionToUpload.rrwebEvents || rrwebEvents }
      : sessionToUpload;

    try {
      const result = await this.transport.upload(fullSession);
      if (result.success) {
        console.log(`GremlinRecorder: Session uploaded via ${result.method}`);
        return { success: true, sessionId: fullSession.header.sessionId };
      } else {
        console.warn(`GremlinRecorder: Upload failed - ${result.error}`);
        return { success: false, sessionId: fullSession.header.sessionId, error: result.error };
      }
    } catch (err) {
      console.error('GremlinRecorder: Upload error', err);
      const error = err instanceof Error ? err.message : 'Unknown upload error';
      return { success: false, sessionId: fullSession.header.sessionId, error };
    }
  }
}

// ============================================================================
// Performance Capability
// ============================================================================

export interface PerformanceCapabilityConfig {
  capturePerformance?: boolean;
  performanceInterval?: number;
}

/**
 * Manages WebPerformanceMonitor lifecycle.
 * Creates and starts the monitor, and provides access to the monitor
 * for session-level performance data retrieval.
 */
export class PerformanceCapability implements RecorderCapability {
  readonly name = 'performance';

  private monitor: WebPerformanceMonitor | null = null;
  private capturePerformance: boolean;
  private setPerformanceProvider: (provider: WebPerformanceMonitor | null) => void;

  constructor(
    config: PerformanceCapabilityConfig,
    setPerformanceProvider: (provider: WebPerformanceMonitor | null) => void,
  ) {
    this.capturePerformance = config.capturePerformance ?? true;
    this.setPerformanceProvider = setPerformanceProvider;
  }

  start(): void {
    if (!this.capturePerformance) return;

    const monitor = new WebPerformanceMonitor({
      trackFPS: true,
      trackLongTasks: true,
      trackWebVitals: true,
      trackMemory: true,
    });
    monitor.start();
    this.monitor = monitor;
    this.setPerformanceProvider(monitor);
  }

  stop(): void {
    // Note: BaseRecorder handles stopping the performanceProvider.
    // We just clear our local reference.
    this.monitor = null;
  }

  destroy(): void {
    this.monitor = null;
    this.setPerformanceProvider(null);
  }

  /** Get the monitor for session-level performance data. */
  getMonitor(): WebPerformanceMonitor | null {
    return this.monitor;
  }
}
