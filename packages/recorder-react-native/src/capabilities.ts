/**
 * React Native Recorder Capabilities
 *
 * Self-contained lifecycle units that encapsulate distinct concerns
 * (transport, performance) for the RN recorder. Each capability
 * implements RecorderCapability and is registered with BaseRecorder
 * to receive start/stop/destroy calls automatically.
 */

import type { GremlinSession, RecorderCapability, UploadResult } from '@gremlin/session';
import { LocalTransport } from './transport';
import { PerformanceMonitor } from './performance-monitor';
import type { TransportConfig } from './types';

// ============================================================================
// Transport Capability
// ============================================================================

export interface RNTransportCapabilityConfig {
  transport?: TransportConfig | false;
  /** Auto-upload session when stopped (default: true when transport enabled). */
  autoUpload?: boolean;
}

/**
 * Manages the RN LocalTransport lifecycle (batching start/stop)
 * and upload policy. Encapsulates transport initialization, session
 * batching, and the upload-on-stop decision.
 */
export class RNTransportCapability implements RecorderCapability {
  readonly name = 'transport';

  private transport: LocalTransport | null = null;
  private autoUpload: boolean;
  private getSession: () => GremlinSession | null;

  constructor(config: RNTransportCapabilityConfig, getSession: () => GremlinSession | null) {
    this.getSession = getSession;

    const transportEnabled = config.transport !== false;
    this.autoUpload = config.autoUpload ?? transportEnabled;

    if (transportEnabled) {
      this.transport = new LocalTransport(config.transport === false ? undefined : config.transport);
    }
  }

  start(): void {
    const session = this.getSession();
    if (this.transport && session) {
      this.transport.startBatching(session.header.sessionId);
    }
  }

  stop(): void {
    if (this.transport) {
      this.transport.stopBatching();
    }
  }

  destroy(): void {
    if (this.transport) {
      this.transport.stopBatching();
    }
    this.transport = null;
  }

  /** Get the transport instance (for upload/queue calls). */
  getTransport(): LocalTransport | null {
    return this.transport;
  }

  /** Whether auto-upload is enabled. */
  isAutoUpload(): boolean {
    return this.autoUpload;
  }

  /**
   * Whether auto-upload should fire on stop.
   * True when autoUpload is enabled and transport exists.
   */
  shouldUploadOnStop(): boolean {
    return this.autoUpload && this.transport !== null;
  }

  /**
   * Upload a session via the local transport.
   * Encapsulates the full upload workflow: null-checks,
   * transport call, and success/failure logging.
   */
  async uploadSession(session?: GremlinSession): Promise<UploadResult> {
    const transport = this.transport;
    if (!transport) {
      console.warn('GremlinRecorder: Transport not configured');
      return { success: false, error: 'Transport not configured' };
    }

    const sessionToUpload = session || this.getSession();
    if (!sessionToUpload) {
      console.warn('GremlinRecorder: No session to upload');
      return { success: false, error: 'No session to upload' };
    }

    try {
      const result = await transport.upload(sessionToUpload);
      if (result.success) {
        console.log(`GremlinRecorder: Session uploaded via ${result.method}`);
        return { success: true, sessionId: sessionToUpload.header.sessionId };
      } else {
        console.warn(`GremlinRecorder: Upload failed - ${result.error}`);
        return { success: false, sessionId: sessionToUpload.header.sessionId, error: result.error };
      }
    } catch (err) {
      console.warn('GremlinRecorder: Upload error', err);
      const error = err instanceof Error ? err.message : 'Unknown upload error';
      return { success: false, sessionId: sessionToUpload.header.sessionId, error };
    }
  }
}

// ============================================================================
// Performance Capability
// ============================================================================

export interface RNPerformanceCapabilityConfig {
  capturePerformance?: boolean;
  performanceInterval?: number;
}

/**
 * Manages the RN PerformanceMonitor lifecycle.
 * Creates and starts the monitor, and wires it to BaseRecorder's
 * performanceProvider for automatic event enrichment.
 */
export class RNPerformanceCapability implements RecorderCapability {
  readonly name = 'performance';

  private monitor: PerformanceMonitor | null = null;
  private capturePerformance: boolean;
  private performanceInterval: number;
  private setPerformanceProvider: (provider: PerformanceMonitor | null) => void;

  constructor(
    config: RNPerformanceCapabilityConfig,
    setPerformanceProvider: (provider: PerformanceMonitor | null) => void,
  ) {
    this.capturePerformance = config.capturePerformance ?? true;
    this.performanceInterval = config.performanceInterval ?? 5000;
    this.setPerformanceProvider = setPerformanceProvider;
  }

  start(): void {
    if (!this.capturePerformance) return;

    const monitor = new PerformanceMonitor({
      sampleInterval: this.performanceInterval,
      trackFPS: true,
      trackMemory: true,
      trackJSLag: true,
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
}
