/**
 * Cloudflare Workers environment types
 */

import type { GremlinSession } from '@gremlin/session';

// Cloudflare Workers R2 types (available in @cloudflare/workers-types)
export interface R2ObjectBody {
  key: string;
  size: number;
  customMetadata?: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Object {
  key: string;
  size: number;
  customMetadata?: Record<string, string>;
}

export interface R2ListResult {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob, options?: unknown): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ListResult>;
  head(key: string): Promise<R2Object | null>;
}

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  /** R2 bucket for session storage */
  SESSIONS: R2Bucket;

  /** API key for authentication */
  API_KEY: string;
}

/**
 * Session list result with pagination
 */
export interface SessionListResult {
  /** List of session summaries */
  sessions: SessionSummary[];

  /** Pagination cursor for next page */
  cursor?: string;

  /** Whether there are more results */
  hasMore: boolean;

  /** Total count (if available) */
  totalCount?: number;
}

/**
 * Session summary for list responses
 */
export interface SessionSummary {
  /** Session ID */
  id: string;

  /** Session start time (Unix ms) */
  startTime: number;

  /** Session end time (Unix ms) */
  endTime?: number;

  /** Duration in milliseconds */
  duration?: number;

  /** Platform */
  platform: 'web' | 'ios' | 'android';

  /** App name */
  appName: string;

  /** App version */
  appVersion: string;

  /** Event count */
  eventCount: number;

  /** Screenshot count */
  screenshotCount: number;

  /** Session size in bytes */
  size: number;

  /** Upload timestamp */
  uploadedAt: number;
}

/**
 * API error response
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Session upload response
 */
export interface SessionUploadResponse {
  /** Session ID */
  id: string;

  /** Upload timestamp */
  uploadedAt: number;

  /** Session size in bytes */
  size: number;
}

/**
 * Session deletion response
 */
export interface SessionDeleteResponse {
  /** Whether deletion was successful */
  deleted: boolean;

  /** Session ID */
  id: string;
}

/**
 * Create a session summary from a full session
 */
export function createSessionSummary(
  id: string,
  session: GremlinSession,
  size: number,
  uploadedAt: number
): SessionSummary {
  const duration =
    session.header.endTime && session.header.startTime
      ? session.header.endTime - session.header.startTime
      : undefined;

  return {
    id,
    startTime: session.header.startTime,
    endTime: session.header.endTime,
    duration,
    platform: session.header.device.platform,
    appName: session.header.app.name,
    appVersion: session.header.app.version,
    eventCount: session.events.length,
    screenshotCount: session.screenshots.length,
    size,
    uploadedAt,
  };
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a session object
 */
export function validateSession(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Session must be an object'] };
  }

  const session = data as Record<string, unknown>;

  // Validate header
  if (!session.header || typeof session.header !== 'object') {
    errors.push('Missing or invalid header');
  } else {
    const header = session.header as Record<string, unknown>;

    if (!header.sessionId || typeof header.sessionId !== 'string') {
      errors.push('Missing or invalid header.sessionId');
    }

    if (!header.startTime || typeof header.startTime !== 'number') {
      errors.push('Missing or invalid header.startTime');
    }

    if (!header.device || typeof header.device !== 'object') {
      errors.push('Missing or invalid header.device');
    }

    if (!header.app || typeof header.app !== 'object') {
      errors.push('Missing or invalid header.app');
    }

    if (!header.schemaVersion || typeof header.schemaVersion !== 'number') {
      errors.push('Missing or invalid header.schemaVersion');
    }
  }

  // Validate arrays
  if (!Array.isArray(session.elements)) {
    errors.push('Missing or invalid elements array');
  }

  if (!Array.isArray(session.events)) {
    errors.push('Missing or invalid events array');
  }

  if (!Array.isArray(session.screenshots)) {
    errors.push('Missing or invalid screenshots array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
