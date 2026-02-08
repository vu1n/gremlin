/**
 * Self-hosted server types
 */

import type { SessionPerformance } from '@gremlin/session';

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
// Self-hosted-specific types
// ============================================================================

export interface ServerConfig {
  port: number;
  dataDir: string;
  apiKey?: string;
  disableAuth: boolean;
  allowedOrigins: string | string[];
}

export interface SessionIndexEntry {
  id: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  platform: 'web' | 'ios' | 'android';
  appName: string;
  appVersion: string;
  eventCount: number;
  screenshotCount: number;
  size: number;
  uploadedAt: number;
  performance?: SessionPerformance;
  storedAt: number;
  path: string;
}
