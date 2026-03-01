/**
 * Server Transport - Send sessions to a deployed Gremlin server
 *
 * Works with both the Cloudflare Workers server (@gremlin/server) and
 * the self-hosted server (@gremlin/server-node). Unlike LocalTransport
 * which talks to the dev server at /v1/sessions, this transport uses the
 * production API at /v1/sessions with API key authentication.
 */

import type { GremlinSession } from '../types.ts';

export interface ServerTransportConfig {
  /** Server URL (e.g., 'https://gremlin.example.com') */
  serverUrl: string;

  /** API key for X-API-Key header */
  apiKey: string;

  /** ms, default: 10000 */
  timeout?: number;

  /** Default: 2 */
  retryAttempts?: number;

  /** ms, default: 500 */
  retryDelayMs?: number;

  debug?: boolean;
}

export interface ServerTransportResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

type LogFn = (msg: string, ...args: unknown[]) => void;

function createLogger(debug: boolean): LogFn {
  if (!debug) return () => {};
  return (msg, ...args) => console.log(`[ServerTransport] ${msg}`, ...args);
}

export class ServerTransport {
  private config: Required<ServerTransportConfig>;
  private log: LogFn;

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
    this.log = createLogger(this.config.debug);
  }

  /** Return the configured server URL (endpoint). */
  getEndpoint(): string {
    return this.config.serverUrl;
  }

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
          this.log('Session uploaded', {
            sessionId: data.id ?? session.header.sessionId,
          });
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
          this.log('Upload failed', message);
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
