/**
 * NetworkInterceptor - Shared fetch/XHR interception for session recorders
 *
 * Patches globalThis.fetch and XMLHttpRequest.prototype to capture network
 * events. Used by both web and React Native recorders.
 *
 * Platform differences are handled via the config:
 * - `resolveUrl`: Web passes a base URL for relative path resolution;
 *   React Native does not (all RN URLs are absolute).
 * - `getFetchTarget`/`setFetchTarget`: Web may target `window.fetch`,
 *   RN targets `globalThis.fetch`. Defaults to globalThis.
 */

import type { NetworkEvent, GremlinEvent } from './types.ts';
import { EventTypeEnum } from './types.ts';

// ============================================================================
// Types
// ============================================================================

export interface NetworkInterceptorConfig {
  /**
   * Callback to record a network event into the session.
   * Called with a partial GremlinEvent (without dt, which the recorder adds).
   */
  addEvent: (event: Omit<GremlinEvent, 'dt'>) => void;

  /** Returns true when the recorder is actively recording. */
  isRecording: () => boolean;

  /**
   * URL patterns to ignore (substring match).
   * Requests whose URL contains any of these strings will be passed through
   * without recording.
   */
  ignorePatterns?: string[];

  /**
   * The transport endpoint URL (e.g. "http://localhost:3334").
   * Requests to this host:port are automatically ignored to avoid
   * self-recording. Defaults to "http://localhost:3334".
   */
  transportEndpoint?: string;

  /**
   * Base URL for resolving relative URLs in sanitizeUrl/shouldIgnoreUrl.
   * Web recorders should pass `window.location.origin`.
   * React Native recorders should omit this (RN URLs are always absolute).
   */
  urlBase?: string;
}

// ============================================================================
// Pure utility functions
// ============================================================================

/**
 * Strip query parameters and hash from a URL for privacy.
 * Returns origin + pathname only.
 *
 * @param raw - The raw URL string
 * @param base - Optional base URL for resolving relative paths (web only)
 */
export function sanitizeUrl(raw: string, base?: string): string {
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    return url.origin + url.pathname;
  } catch {
    return raw;
  }
}

/**
 * Determine whether a URL should be excluded from network capture.
 *
 * Excluded:
 * - data: and blob: URLs
 * - Requests to the gremlin transport endpoint (self-recording)
 * - Requests matching any user-provided ignore pattern
 *
 * @param url - The request URL
 * @param transportEndpoint - The gremlin dev server endpoint
 * @param ignorePatterns - User-provided substring patterns to ignore
 * @param base - Optional base URL for resolving relative paths (web only)
 */
export function shouldIgnoreUrl(
  url: string,
  transportEndpoint: string,
  ignorePatterns: string[],
  base?: string,
): boolean {
  // Skip data: and blob: URLs
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;

  // Skip requests to the gremlin dev server
  try {
    const reqUrl = base ? new URL(url, base) : new URL(url);
    const devUrl = new URL(transportEndpoint);
    if (reqUrl.hostname === devUrl.hostname && reqUrl.port === devUrl.port) {
      return true;
    }
  } catch {
    // If parsing fails, check for localhost:3334 substring
    if (url.includes('localhost:3334')) return true;
  }

  // Check user-provided ignore patterns
  for (const pattern of ignorePatterns) {
    if (url.includes(pattern)) return true;
  }

  return false;
}

// ============================================================================
// NetworkInterceptor class
// ============================================================================

/**
 * Intercepts fetch and XMLHttpRequest to record network events.
 *
 * Usage:
 * ```ts
 * const interceptor = new NetworkInterceptor({
 *   addEvent: (event) => this.addEventToSession(event),
 *   isRecording: () => this.isRecording(),
 *   ignorePatterns: ['analytics.example.com'],
 *   urlBase: window.location.origin, // web only
 * });
 *
 * interceptor.install();
 * // ... recording ...
 * interceptor.uninstall();
 * ```
 */
export class NetworkInterceptor {
  private config: NetworkInterceptorConfig;
  private transportEndpoint: string;
  private ignorePatterns: string[];
  private urlBase: string | undefined;

  // Saved originals for restoration
  private originalFetch: typeof globalThis.fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

  // State
  private requestCounter = 0;
  private xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  private installed = false;

  constructor(config: NetworkInterceptorConfig) {
    this.config = config;
    this.transportEndpoint = config.transportEndpoint ?? 'http://localhost:3334';
    this.ignorePatterns = config.ignorePatterns ?? [];
    this.urlBase = config.urlBase;
  }

  /** Reset the request counter (call on recorder start). */
  resetCounter(): void {
    this.requestCounter = 0;
  }

  /** Generate the next sequential request ID. */
  private nextRequestId(): string {
    return `net_${++this.requestCounter}`;
  }

  /** Whether the interceptor is currently installed. */
  isInstalled(): boolean {
    return this.installed;
  }

  // ==========================================================================
  // Install / Uninstall
  // ==========================================================================

  /**
   * Patch globalThis.fetch and XMLHttpRequest to intercept network requests.
   * Safe to call multiple times (no-ops if already installed).
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.installFetch();
    this.installXhr();
  }

  /**
   * Restore original fetch and XMLHttpRequest prototypes.
   * Safe to call multiple times (no-ops if not installed).
   */
  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;

    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    if (this.originalXhrOpen) {
      XMLHttpRequest.prototype.open = this.originalXhrOpen;
      this.originalXhrOpen = null;
    }
    if (this.originalXhrSend) {
      XMLHttpRequest.prototype.send = this.originalXhrSend;
      this.originalXhrSend = null;
    }
  }

  // ==========================================================================
  // Fetch interception
  // ==========================================================================

  private installFetch(): void {
    this.originalFetch = globalThis.fetch;
    const self = this;

    const wrappedFetch = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method =
        init?.method ??
        (typeof input === 'string' || input instanceof URL
          ? 'GET'
          : input.method) ??
        'GET';

      if (shouldIgnoreUrl(url, self.transportEndpoint, self.ignorePatterns, self.urlBase)) {
        return self.originalFetch!(input, init);
      }

      const requestId = self.nextRequestId();
      const sanitized = sanitizeUrl(url, self.urlBase);
      const startTime = Date.now();

      // Record start event
      if (self.config.isRecording()) {
        self.config.addEvent({
          type: EventTypeEnum.NETWORK,
          data: {
            kind: 'network',
            requestId,
            method: method.toUpperCase(),
            url: sanitized,
            phase: 'start',
          } as NetworkEvent,
        });
      }

      return self.originalFetch!(input, init).then(
        (response) => {
          if (self.config.isRecording()) {
            self.config.addEvent({
              type: EventTypeEnum.NETWORK,
              data: {
                kind: 'network',
                requestId,
                method: method.toUpperCase(),
                url: sanitized,
                status: response.status,
                duration: Date.now() - startTime,
                phase: 'end',
              } as NetworkEvent,
            });
          }
          return response;
        },
        (error) => {
          if (self.config.isRecording()) {
            self.config.addEvent({
              type: EventTypeEnum.NETWORK,
              data: {
                kind: 'network',
                requestId,
                method: method.toUpperCase(),
                url: sanitized,
                duration: Date.now() - startTime,
                phase: 'error',
                error: error instanceof Error ? error.message : String(error),
              } as NetworkEvent,
            });
          }
          throw error;
        },
      );
    };

    // Copy static properties from original fetch (e.g., preconnect)
    Object.assign(wrappedFetch, this.originalFetch);
    globalThis.fetch = wrappedFetch as typeof globalThis.fetch;
  }

  // ==========================================================================
  // XHR interception
  // ==========================================================================

  private installXhr(): void {
    // XMLHttpRequest may not be available in all environments (e.g. some RN setups)
    if (typeof XMLHttpRequest === 'undefined') return;

    this.originalXhrOpen = XMLHttpRequest.prototype.open;
    this.originalXhrSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      self.xhrMetadata.set(this, {
        method,
        url: typeof url === 'string' ? url : url.href,
      });
      return self.originalXhrOpen!.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const meta = self.xhrMetadata.get(this);
      const method: string = meta?.method ?? 'GET';
      const url: string = meta?.url ?? '';

      if (shouldIgnoreUrl(url, self.transportEndpoint, self.ignorePatterns, self.urlBase)) {
        return self.originalXhrSend!.call(this, body);
      }

      const requestId = self.nextRequestId();
      const sanitized = sanitizeUrl(url, self.urlBase);
      const startTime = Date.now();

      if (self.config.isRecording()) {
        self.config.addEvent({
          type: EventTypeEnum.NETWORK,
          data: {
            kind: 'network',
            requestId,
            method: method.toUpperCase(),
            url: sanitized,
            phase: 'start',
          } as NetworkEvent,
        });
      }

      this.addEventListener('load', () => {
        if (self.config.isRecording()) {
          self.config.addEvent({
            type: EventTypeEnum.NETWORK,
            data: {
              kind: 'network',
              requestId,
              method: method.toUpperCase(),
              url: sanitized,
              status: this.status,
              duration: Date.now() - startTime,
              phase: 'end',
            } as NetworkEvent,
          });
        }
      });

      this.addEventListener('error', () => {
        if (self.config.isRecording()) {
          self.config.addEvent({
            type: EventTypeEnum.NETWORK,
            data: {
              kind: 'network',
              requestId,
              method: method.toUpperCase(),
              url: sanitized,
              duration: Date.now() - startTime,
              phase: 'error',
              error: 'Network request failed',
            } as NetworkEvent,
          });
        }
      });

      this.addEventListener('abort', () => {
        if (self.config.isRecording()) {
          self.config.addEvent({
            type: EventTypeEnum.NETWORK,
            data: {
              kind: 'network',
              requestId,
              method: method.toUpperCase(),
              url: sanitized,
              duration: Date.now() - startTime,
              phase: 'error',
              error: 'Request aborted',
            } as NetworkEvent,
          });
        }
      });

      return self.originalXhrSend!.call(this, body);
    };
  }
}
