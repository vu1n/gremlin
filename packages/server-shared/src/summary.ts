/**
 * Shared session summary projection.
 *
 * Both the CF Workers storage (R2 metadata → SessionSummary) and the
 * self-hosted storage (SessionIndexEntry → SessionSummary) need to
 * assemble the same shape. This module provides a single function so
 * the mapping logic is defined once.
 */

import type { SessionPerformance } from '@gremlin/session';
import type { SessionSummary } from './types.ts';

/**
 * Metadata fields that can be stored as strings (R2 custom metadata)
 * or already-parsed values (filesystem index entries). The function
 * handles both.
 */
export interface SessionMetadataRecord {
  id: string;
  startTime?: string | number;
  endTime?: string | number;
  platform?: string;
  appName?: string;
  appVersion?: string;
  eventCount?: string | number;
  screenshotCount?: string | number;
  size: number;
  uploadedAt?: string | number;
  performance?: SessionPerformance | string;
}

function toInt(value: string | number | undefined, fallback = 0): number {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'number') return value;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function parsePerformance(raw?: SessionPerformance | string): SessionPerformance | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) as SessionPerformance;
  } catch {
    return undefined;
  }
}

/**
 * Convert a metadata record (from R2 custom metadata or a filesystem
 * index entry) into a canonical SessionSummary.
 */
export function toSessionSummary(meta: SessionMetadataRecord): SessionSummary {
  const startTime = toInt(meta.startTime, 0);
  const endTime = meta.endTime ? toInt(meta.endTime) : undefined;
  const duration =
    endTime !== undefined && startTime
      ? endTime - startTime
      : undefined;

  return {
    id: meta.id,
    startTime,
    endTime,
    duration,
    platform: (meta.platform || 'web') as 'web' | 'ios' | 'android',
    appName: meta.appName || 'unknown',
    appVersion: meta.appVersion || 'unknown',
    eventCount: toInt(meta.eventCount),
    screenshotCount: toInt(meta.screenshotCount),
    size: meta.size,
    uploadedAt: toInt(meta.uploadedAt),
    performance: parsePerformance(meta.performance),
  };
}
