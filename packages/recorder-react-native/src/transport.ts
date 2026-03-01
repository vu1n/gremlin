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
import type { TransportConfig } from './types.ts';

export interface TransportResult {
  success: boolean;
  method: 'server' | 'storage' | 'none';
  error?: string;
}

/** Minimal structural type for the subset of AsyncStorage API we use. */
interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

// Lazy-load AsyncStorage to avoid Metro bundling issues with optional peer deps
let _asyncStorage: AsyncStorageLike | null;
let _asyncStorageResolved = false;

function getAsyncStorage(): AsyncStorageLike | null {
  if (_asyncStorageResolved) return _asyncStorage;
  _asyncStorageResolved = true;
  try {
    _asyncStorage = require('@react-native-async-storage/async-storage').default;
  } catch {
    _asyncStorage = null;
  }
  return _asyncStorage;
}


type LogFn = (msg: string, ...args: unknown[]) => void;

function createLogger(debug: boolean): { log: LogFn; error: LogFn } {
  if (!debug) {
    const noop: LogFn = () => {};
    return { log: noop, error: noop };
  }
  return {
    log: (msg, ...args) => console.debug(`[GremlinTransport] ${msg}`, ...args),
    error: (msg, ...args) => console.debug(`[GremlinTransport] ${msg}`, ...args),
  };
}


export class LocalTransport {
  private config: Required<TransportConfig>;
  private debug: { log: LogFn; error: LogFn };
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

    this.debug = createLogger(this.config.debug);
    this.debug.log('Initialized', {
      endpoint: this.config.endpoint,
      fallbackToStorage: this.config.fallbackToStorage,
      asyncStorageAvailable: !!getAsyncStorage(),
    });
  }

  /** Return the configured endpoint URL. */
  getEndpoint(): string {
    return this.config.endpoint;
  }

  startBatching(sessionId: string): void {
    this.sessionId = sessionId;
    this.pendingEvents = [];

    if (this.config.batchInterval > 0) {
      this.batchTimer = setInterval(() => {
        this.flushBatch();
      }, this.config.batchInterval);
    }
  }

  queueEvent(event: GremlinEvent): void {
    this.pendingEvents.push(event);
  }

  stopBatching(): void {
    // Fire-and-forget: full session upload follows immediately, so no data loss
    void this.flushBatch();
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  async upload(session: GremlinSession): Promise<TransportResult> {
    // Stop any active batching
    this.stopBatching();

    // Try server first
    const serverResult = await this.tryServer(session);
    if (serverResult.success) {
      return serverResult;
    }

    // Fall back to AsyncStorage if enabled and available
    if (this.config.fallbackToStorage && getAsyncStorage()) {
      return this.saveToStorage(session);
    }

    return {
      success: false,
      method: 'none',
      error: serverResult.error,
    };
  }

  async uploadBatch(
    sessionId: string,
    events: GremlinEvent[],
    rrwebEvents?: unknown[]
  ): Promise<TransportResult> {
    try {
      const response = await fetch(`${this.config.endpoint}/v1/sessions/${sessionId}/events`, {
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
        this.debug.log('Batch uploaded', { sessionId, events: events.length });
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
      this.debug.log('Batch upload failed', error);
      return { success: false, method: 'server', error };
    }
  }

  async checkServer(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      this.serverAvailable = response.ok;
      return this.serverAvailable;
    } catch {
      this.serverAvailable = false;
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  isServerAvailable(): boolean | null {
    return this.serverAvailable;
  }

  /**
   * Flush any sessions stored in AsyncStorage to the server.
   */
  async flushStoredSessions(): Promise<number> {
    const AsyncStorage = getAsyncStorage();
    if (!AsyncStorage) return 0;

    try {
      const keys = await AsyncStorage.getAllKeys();
      const sessionKeys = keys.filter((k) => k.startsWith('gremlin_session_'));

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
          this.debug.error('Failed to flush session', key, e);
        }
      }

      if (flushed > 0) {
        this.debug.log(`Flushed ${flushed} stored sessions`);
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

    const result = await this.uploadBatch(this.sessionId, events);
    if (!result.success) {
      // Prepend failed events back so they're retried on next flush
      this.pendingEvents = [...events, ...this.pendingEvents];
    }
  }

  private async tryServer(session: GremlinSession): Promise<TransportResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${this.config.endpoint}/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
        signal: controller.signal,
      });

      if (response.ok) {
        this.serverAvailable = true;
        this.debug.log('Session uploaded', {
          sessionId: session.header.sessionId,
          events: session.events.length,
          elements: session.elements.length,
        });
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
      this.debug.log('Server unavailable', error);

      return { success: false, method: 'server', error };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async saveToStorage(session: GremlinSession): Promise<TransportResult> {
    const AsyncStorage = getAsyncStorage();
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

      this.debug.log('Session saved to AsyncStorage', {
        sessionId: session.header.sessionId,
        key,
      });

      return { success: true, method: 'storage' };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, method: 'storage', error };
    }
  }
}
