/**
 * Cloudflare Workers environment types
 */

// Re-export shared server types (single source of truth)
export {
  type SessionListResult,
  type SessionSummary,
  type ErrorResponse,
  type SessionUploadResponse,
  type SessionDeleteResponse,
  type ValidationResult,
  validateSession,
  createSessionSummary,
} from '@gremlin/server-shared';

// ============================================================================
// Cloudflare-specific types
// ============================================================================

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

  /** Comma-separated allowed origins, or '*' (default: '*') */
  ALLOWED_ORIGINS?: string;
}
