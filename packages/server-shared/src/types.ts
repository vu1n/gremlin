/**
 * Shared server types used by both Cloudflare Workers and self-hosted servers.
 *
 * This is the single source of truth for API response shapes, session
 * summaries, validation, and helper functions that were previously
 * duplicated across @gremlin/server and @gremlin/server-node.
 */

import type { GremlinSession, SessionPerformance } from '@gremlin/session';
import { GremlinSessionSchema } from './validation.ts';

export interface SessionListResult {
  sessions: SessionSummary[];
  cursor?: string;
  hasMore: boolean;
  totalCount?: number;
}

export interface SessionSummary {
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
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface SessionUploadResponse {
  id: string;
  uploadedAt: number;
  size: number;
}

export interface SessionDeleteResponse {
  deleted: boolean;
  id: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a session using the canonical Zod schema.
 *
 * Returns a ValidationResult with structured error messages for API responses.
 * Uses GremlinSessionSchema from ./validation.ts as the single source of truth.
 */
export function validateSession(data: unknown): ValidationResult {
  const result = GremlinSessionSchema.safeParse(data);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });

  return { valid: false, errors };
}

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
    performance: session.performance,
  };
}
