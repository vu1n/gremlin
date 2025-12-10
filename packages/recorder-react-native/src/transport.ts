/**
 * Local Transport for React Native
 *
 * Sends sessions to local gremlin dev server.
 * Uses AsyncStorage for fallback (optional peer dependency).
 *
 * For RN, the endpoint must be your dev machine's IP address
 * since localhost refers to the device/simulator itself.
 */

import type { GremlinSession, GremlinEvent } from '@gremlin/session';

// ============================================================================
// Types
// ============================================================================

export interface TransportConfig {
  /**
   * Dev server endpoint.
   * For RN, use your machine's IP: http://192.168.1.100:3334
   * Default: http://localhost:3334 (works in simulator on same machine)
   */
  endpoint?: string;

  /**
   * Fall back to AsyncStorage if server unavailable.
   * Requires @react-native-async-storage/async-storage as peer dep.
   * Default: false (since it requires extra dependency)
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

export interface TransportResult {
  success: boolean;
  method: 'server' | 'storage' | 'none';
  error?: string;
}

// Try to import AsyncStorage if available
let AsyncStorage: any = null;
try {
  // Dynamic import to avoid hard dependency
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  // AsyncStorage not installed - fallback disabled
}

// ============================================================================
// LocalTransport
// ============================================================================

export class LocalTransport {
  private config: Required<TransportConfig>;
  private serverAvailable: boolean | null = null;
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private pendingEvents: GremlinEvent[] = [];
  private sessionId: string | null = null;

  constructor(config: TransportConfig = {}) {
    this.config = {
      endpoint: config.endpoint ?? 'http://localhost:3334',
      fallbackToStorage: config.fallbackToStorage ?? false,
      autoUpload: config.autoUpload ?? true,
      batchInterval: config.batchInterval ?? 30000,
      debug: config.debug ?? false,
    };

    if (this.config.debug) {
      console.log('[GremlinTransport] Initialized', {
        endpoint: this.config.endpoint,
        fallbackToStorage: this.config.fallbackToStorage,
        asyncStorageAvailable: !!AsyncStorage,
      });
    }
  }

  /**
   * Start batch uploading for a session.
   */
  startBatching(sessionId: string): void {
    this.sessionId = sessionId;
    this.pendingEvents = [];

    if (this.config.batchInterval > 0) {
      this.batchTimer = setInterval(() => {
        this.flushBatch();
      }, this.config.batchInterval);
    }
  }

  /**
   * Queue an event for batch upload.
   */
  queueEvent(event: GremlinEvent): void {
    this.pendingEvents.push(event);
  }

  /**
   * Stop batch uploading.
   */
  stopBatching(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Upload a complete session.
   */
  async upload(session: GremlinSession): Promise<TransportResult> {
    // Stop any active batching
    this.stopBatching();

    // Try server first
    const serverResult = await this.tryServer(session);
    if (serverResult.success) {
      return serverResult;
    }

    // Fall back to AsyncStorage if enabled and available
    if (this.config.fallbackToStorage && AsyncStorage) {
      return this.saveToStorage(session);
    }

    return {
      success: false,
      method: 'none',
      error: serverResult.error,
    };
  }

  /**
   * Upload batched events (incremental upload during recording).
   */
  async uploadBatch(
    sessionId: string,
    events: GremlinEvent[],
    rrwebEvents?: any[]
  ): Promise<TransportResult> {
    try {
      const response = await fetch(`${this.config.endpoint}/session/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          events,
          rrwebEvents,
        }),
        // @ts-ignore - AbortSignal.timeout may not be typed in RN
        signal: AbortSignal.timeout?.(5000),
      });

      if (response.ok) {
        this.serverAvailable = true;
        if (this.config.debug) {
          console.log('[GremlinTransport] Batch uploaded', {
            sessionId,
            events: events.length,
          });
        }
        return { success: true, method: 'server' };
      }

      return {
        success: false,
        method: 'server',
        error: `Server returned ${response.status}`,
      };
    } catch (e) {
      this.serverAvailable = false;
      const error = e instanceof Error ? e.message : 'Unknown error';
      if (this.config.debug) {
        console.log('[GremlinTransport] Batch upload failed', error);
      }
      return { success: false, method: 'server', error };
    }
  }

  /**
   * Check if dev server is available.
   */
  async checkServer(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      this.serverAvailable = response.ok;
      return this.serverAvailable;
    } catch {
      this.serverAvailable = false;
      return false;
    }
  }

  /**
   * Get server availability status.
   */
  isServerAvailable(): boolean | null {
    return this.serverAvailable;
  }

  /**
   * Flush any sessions stored in AsyncStorage to the server.
   */
  async flushStoredSessions(): Promise<number> {
    if (!AsyncStorage) return 0;

    try {
      const keys = await AsyncStorage.getAllKeys();
      const sessionKeys = keys.filter((k: string) => k.startsWith('gremlin_session_'));

      let flushed = 0;
      for (const key of sessionKeys) {
        try {
          const data = await AsyncStorage.getItem(key);
          if (!data) continue;

          const session = JSON.parse(data) as GremlinSession;
          const result = await this.tryServer(session);

          if (result.success) {
            await AsyncStorage.removeItem(key);
            flushed++;
          }
        } catch (e) {
          if (this.config.debug) {
            console.error('[GremlinTransport] Failed to flush session', key, e);
          }
        }
      }

      if (this.config.debug && flushed > 0) {
        console.log(`[GremlinTransport] Flushed ${flushed} stored sessions`);
      }

      return flushed;
    } catch {
      return 0;
    }
  }

  // ========================================================================
  // Private
  // ========================================================================

  private async flushBatch(): Promise<void> {
    if (!this.sessionId || this.pendingEvents.length === 0) return;

    const events = [...this.pendingEvents];
    this.pendingEvents = [];

    await this.uploadBatch(this.sessionId, events);
  }

  private async tryServer(session: GremlinSession): Promise<TransportResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${this.config.endpoint}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        this.serverAvailable = true;
        if (this.config.debug) {
          console.log('[GremlinTransport] Session uploaded', {
            sessionId: session.header.sessionId,
            events: session.events.length,
            elements: session.elements.length,
          });
        }
        return { success: true, method: 'server' };
      }

      return {
        success: false,
        method: 'server',
        error: `Server returned ${response.status}`,
      };
    } catch (e) {
      this.serverAvailable = false;
      const error = e instanceof Error ? e.message : 'Unknown error';

      if (this.config.debug) {
        console.log('[GremlinTransport] Server unavailable', error);
      }

      return { success: false, method: 'server', error };
    }
  }

  private async saveToStorage(session: GremlinSession): Promise<TransportResult> {
    if (!AsyncStorage) {
      return {
        success: false,
        method: 'storage',
        error: 'AsyncStorage not available',
      };
    }

    try {
      const key = `gremlin_session_${session.header.sessionId}`;
      await AsyncStorage.setItem(key, JSON.stringify(session));

      if (this.config.debug) {
        console.log('[GremlinTransport] Session saved to AsyncStorage', {
          sessionId: session.header.sessionId,
          key,
        });
      }

      return { success: true, method: 'storage' };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, method: 'storage', error };
    }
  }
}
