/**
 * Streaming Transport - Send events in real-time to gremlin dev server
 *
 * For local development only. Streams events as they happen rather than
 * batching everything until session end.
 *
 * Features:
 * - Batches events by time interval (default: 2 seconds)
 * - Sends to /session/append endpoint
 * - Uses sendBeacon on page unload for reliability
 * - Falls back to localStorage if server unavailable
 */

import type { GremlinSession, GremlinEvent } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface StreamingTransportConfig {
  /** Server endpoint (default: http://localhost:3334) */
  endpoint?: string;

  /** Batch interval in ms (default: 2000) */
  batchInterval?: number;

  /** Max events per batch before force flush (default: 50) */
  maxBatchSize?: number;

  /** Fall back to localStorage if server unavailable */
  fallbackToStorage?: boolean;

  /** Debug logging */
  debug?: boolean;
}

// ============================================================================
// StreamingTransport
// ============================================================================

export class StreamingTransport {
  private config: Required<StreamingTransportConfig>;
  private sessionId: string | null = null;
  private pendingEvents: GremlinEvent[] = [];
  private pendingRrwebEvents: unknown[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private serverAvailable = true;

  constructor(config: StreamingTransportConfig = {}) {
    this.config = {
      endpoint: config.endpoint ?? 'http://localhost:3334',
      batchInterval: config.batchInterval ?? 2000,
      maxBatchSize: config.maxBatchSize ?? 50,
      fallbackToStorage: config.fallbackToStorage ?? true,
      debug: config.debug ?? false,
    };
  }

  /**
   * Start streaming for a session.
   * Call this when recording starts.
   */
  start(sessionId: string): void {
    this.sessionId = sessionId;
    this.pendingEvents = [];
    this.pendingRrwebEvents = [];

    // Start batch flush timer
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.batchInterval);

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleUnload);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (this.config.debug) {
      console.log(`[StreamingTransport] Started for session ${sessionId}`);
    }
  }

  /**
   * Stop streaming. Flushes any pending events.
   */
  stop(): void {
    // Final flush
    this.flush();

    // Clear timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Remove listeners
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleUnload);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (this.config.debug) {
      console.log(`[StreamingTransport] Stopped for session ${this.sessionId}`);
    }

    this.sessionId = null;
  }

  /**
   * Queue a gremlin event for streaming.
   */
  pushEvent(event: GremlinEvent): void {
    this.pendingEvents.push(event);

    // Force flush if batch is full
    if (this.pendingEvents.length >= this.config.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Queue an rrweb event for streaming.
   */
  pushRrwebEvent(event: unknown): void {
    this.pendingRrwebEvents.push(event);

    // Force flush if batch is full
    if (this.pendingRrwebEvents.length >= this.config.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flush pending events to server.
   */
  flush(): void {
    if (!this.sessionId) return;
    if (this.pendingEvents.length === 0 && this.pendingRrwebEvents.length === 0) return;

    const payload = {
      sessionId: this.sessionId,
      events: this.pendingEvents,
      rrwebEvents: this.pendingRrwebEvents,
    };

    // Clear pending before async send (prevents duplicate sends)
    const eventCount = this.pendingEvents.length;
    const rrwebCount = this.pendingRrwebEvents.length;
    this.pendingEvents = [];
    this.pendingRrwebEvents = [];

    // Send async (don't await - fire and forget)
    this.sendBatch(payload).then((success) => {
      if (this.config.debug) {
        console.log(
          `[StreamingTransport] Flushed ${eventCount} events, ${rrwebCount} rrweb - ${success ? 'ok' : 'failed'}`
        );
      }
    });
  }

  /**
   * Flush using sendBeacon (for page unload).
   */
  flushBeacon(): void {
    if (!this.sessionId) return;
    if (this.pendingEvents.length === 0 && this.pendingRrwebEvents.length === 0) return;

    const payload = {
      sessionId: this.sessionId,
      events: this.pendingEvents,
      rrwebEvents: this.pendingRrwebEvents,
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const sent = navigator.sendBeacon(`${this.config.endpoint}/session/append`, blob);

    if (this.config.debug) {
      console.log(`[StreamingTransport] Beacon flush: ${sent ? 'sent' : 'failed'}`);
    }

    // Clear pending
    this.pendingEvents = [];
    this.pendingRrwebEvents = [];
  }

  /**
   * Upload a complete session (fallback for non-streaming scenarios).
   */
  async uploadSession(session: GremlinSession): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch {
      if (this.config.fallbackToStorage) {
        this.saveToStorage(session);
      }
      return false;
    }
  }

  // ========================================================================
  // Private
  // ========================================================================

  private async sendBatch(payload: {
    sessionId: string;
    events: GremlinEvent[];
    rrwebEvents: unknown[];
  }): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/session/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });

      this.serverAvailable = response.ok;
      return response.ok;
    } catch {
      this.serverAvailable = false;

      // Save to localStorage as fallback
      if (this.config.fallbackToStorage) {
        this.appendToStorage(payload);
      }

      return false;
    }
  }

  private saveToStorage(session: GremlinSession): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const key = `gremlin_session_${session.header.sessionId}`;
      localStorage.setItem(key, JSON.stringify(session));
    } catch {
      // Storage full or unavailable
    }
  }

  private appendToStorage(payload: {
    sessionId: string;
    events: GremlinEvent[];
    rrwebEvents: unknown[];
  }): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const key = `gremlin_pending_${payload.sessionId}`;
      const existing = localStorage.getItem(key);
      const data = existing ? JSON.parse(existing) : { events: [], rrwebEvents: [] };

      data.events.push(...payload.events);
      data.rrwebEvents.push(...payload.rrwebEvents);

      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage full or unavailable
    }
  }

  private handleUnload = (): void => {
    this.flushBeacon();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.flushBeacon();
    }
  };
}
