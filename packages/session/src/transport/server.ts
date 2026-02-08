/**
 * Server Transport - Send sessions to a deployed Gremlin server
 *
 * Works with both the Cloudflare Workers server (@gremlin/server) and
 * the self-hosted server (@gremlin/server-node). Unlike LocalTransport
 * which talks to the dev server at /session, this transport uses the
 * production API at /v1/sessions with API key authentication.
 */

import type { GremlinSession } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface ServerTransportConfig {
  /** Server URL (e.g., 'https://gremlin.example.com') */
  serverUrl: string;

  /** API key for X-API-Key header */
  apiKey: string;

  /** Request timeout in ms (default: 10000) */
  timeout?: number;

  /** Retry attempts (default: 2) */
  retryAttempts?: number;

  /** Base retry delay in ms (default: 500) */
  retryDelayMs?: number;

  /** Debug logging */
  debug?: boolean;
}

export interface ServerTransportResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

// ============================================================================
// ServerTransport
// ============================================================================

export class ServerTransport {
  private config: Required<ServerTransportConfig>;

  constructor(config: ServerTransportConfig) {
    // Strip trailing slash from serverUrl
    const serverUrl = config.serverUrl.replace(/\/+$/, '');

    this.config = {
      serverUrl,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 10000,
      retryAttempts: config.retryAttempts ?? 2,
      retryDelayMs: config.retryDelayMs ?? 500,
      debug: config.debug ?? false,
    };
  }

  /**
   * Upload a session to the production server.
   */
  async upload(session: GremlinSession): Promise<ServerTransportResult> {
    const maxAttempts = Math.max(1, this.config.retryAttempts + 1);

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.config.serverUrl}/v1/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey,
          },
          body: JSON.stringify(session),
          signal: AbortSignal.timeout(this.config.timeout),
        });

        if (response.ok) {
          const data = await response.json() as { id?: string };
          if (this.config.debug) {
            console.log('[ServerTransport] Session uploaded', {
              sessionId: data.id ?? session.header.sessionId,
            });
          }
          return { success: true, sessionId: data.id ?? session.header.sessionId };
        }

        const errorBody = await response.text().catch(() => '');
        const error = `Server returned ${response.status}: ${errorBody}`;

        // Don't retry 4xx errors (client-side problems)
        if (response.status >= 400 && response.status < 500) {
          return { success: false, error };
        }

        // Retry 5xx errors
        if (i === maxAttempts - 1) {
          return { success: false, error };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (i === maxAttempts - 1) {
          if (this.config.debug) {
            console.log('[ServerTransport] Upload failed', message);
          }
          return { success: false, error: message };
        }
      }

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.retryDelayMs * Math.pow(2, i))
      );
    }

    return { success: false, error: 'Retry attempts exhausted' };
  }

  /**
   * Check if the server is reachable.
   */
  async checkServer(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.serverUrl}/`, {
        method: 'GET',
        headers: { 'X-API-Key': this.config.apiKey },
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
