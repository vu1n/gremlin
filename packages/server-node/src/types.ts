/**
 * Self-hosted server types
 */

import type { GremlinSession, SessionPerformance } from '@gremlin/session';

export interface ServerConfig {
  port: number;
  dataDir: string;
  apiKey?: string;
  disableAuth: boolean;
  allowedOrigins: string | string[];
}

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

export interface SessionIndexEntry extends SessionSummary {
  storedAt: number;
  path: string;
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

export function validateSession(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Session must be an object'] };
  }

  const session = data as Record<string, unknown>;

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
