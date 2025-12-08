/**
 * Local Transport - Send sessions to local gremlin dev server
 *
 * Default transport for development:
 * 1. Tries to POST to localhost:3334
 * 2. Falls back to localStorage if server unavailable
 * 3. Buffered sessions can be flushed when server becomes available
 */

import type { GremlinSession } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface LocalTransportConfig {
  /** Local server endpoint (default: http://localhost:3334) */
  endpoint?: string;

  /** Fall back to localStorage if server unavailable (default: true) */
  fallbackToStorage?: boolean;

  /** Storage key prefix for localStorage fallback */
  storagePrefix?: string;

  /** Debug logging */
  debug?: boolean;
}

export interface TransportResult {
  success: boolean;
  method: 'server' | 'storage' | 'none';
  error?: string;
}

// ============================================================================
// LocalTransport
// ============================================================================

export class LocalTransport {
  private config: Required<LocalTransportConfig>;
  private serverAvailable: boolean | null = null;

  constructor(config: LocalTransportConfig = {}) {
    this.config = {
      endpoint: config.endpoint ?? 'http://localhost:3334',
      fallbackToStorage: config.fallbackToStorage ?? true,
      storagePrefix: config.storagePrefix ?? 'gremlin_session_',
      debug: config.debug ?? false,
    };
  }

  /**
   * Upload a session to the local dev server or localStorage fallback.
   */
  async upload(session: GremlinSession): Promise<TransportResult> {
    // Try server first
    const serverResult = await this.tryServer(session);
    if (serverResult.success) {
      return serverResult;
    }

    // Fall back to localStorage
    if (this.config.fallbackToStorage) {
      return this.saveToStorage(session);
    }

    return {
      success: false,
      method: 'none',
      error: serverResult.error,
    };
  }

  /**
   * Check if local dev server is available.
   */
  async checkServer(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });
      this.serverAvailable = response.ok;
      return this.serverAvailable;
    } catch {
      this.serverAvailable = false;
      return false;
    }
  }

  /**
   * Flush any sessions stored in localStorage to the server.
   * Call this when server becomes available.
   */
  async flushStoredSessions(): Promise<number> {
    if (typeof localStorage === 'undefined') return 0;

    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(this.config.storagePrefix)
    );

    let flushed = 0;
    for (const key of keys) {
      try {
        const data = localStorage.getItem(key);
        if (!data) continue;

        const session = JSON.parse(data) as GremlinSession;
        const result = await this.tryServer(session);

        if (result.success) {
          localStorage.removeItem(key);
          flushed++;
        }
      } catch (e) {
        if (this.config.debug) {
          console.error('[LocalTransport] Failed to flush session', key, e);
        }
      }
    }

    if (this.config.debug && flushed > 0) {
      console.log(`[LocalTransport] Flushed ${flushed} stored sessions`);
    }

    return flushed;
  }

  /**
   * Get count of sessions stored in localStorage.
   */
  getStoredSessionCount(): number {
    if (typeof localStorage === 'undefined') return 0;

    return Object.keys(localStorage).filter((k) =>
      k.startsWith(this.config.storagePrefix)
    ).length;
  }

  // ========================================================================
  // Private
  // ========================================================================

  private async tryServer(session: GremlinSession): Promise<TransportResult> {
    try {
      const response = await fetch(`${this.config.endpoint}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        this.serverAvailable = true;
        if (this.config.debug) {
          console.log('[LocalTransport] Session uploaded to server', {
            sessionId: session.header.sessionId,
            events: session.events.length,
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
        console.log('[LocalTransport] Server unavailable', error);
      }

      return { success: false, method: 'server', error };
    }
  }

  private saveToStorage(session: GremlinSession): TransportResult {
    if (typeof localStorage === 'undefined') {
      return {
        success: false,
        method: 'storage',
        error: 'localStorage not available',
      };
    }

    try {
      const key = `${this.config.storagePrefix}${session.header.sessionId}`;
      localStorage.setItem(key, JSON.stringify(session));

      if (this.config.debug) {
        console.log('[LocalTransport] Session saved to localStorage', {
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
