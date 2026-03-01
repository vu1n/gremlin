/**
 * Tests for toSessionSummary metadata projection.
 *
 * Covers:
 * - String-to-number coercion for startTime, endTime, etc.
 * - Duration calculation
 * - Default/fallback values
 * - Performance parsing from JSON string or object
 */

import { describe, test, expect } from 'bun:test';
import { toSessionSummary } from './summary.ts';
import type { SessionMetadataRecord } from './summary.ts';

// ============================================================================
// toSessionSummary - basic
// ============================================================================

describe('toSessionSummary', () => {
  test('converts a complete metadata record with numeric values', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-001',
      startTime: 1700000000000,
      endTime: 1700000060000,
      platform: 'web',
      appName: 'TestApp',
      appVersion: '1.0.0',
      eventCount: 42,
      screenshotCount: 5,
      size: 1024,
      uploadedAt: 1700000100000,
    };

    const summary = toSessionSummary(meta);

    expect(summary.id).toBe('sess-001');
    expect(summary.startTime).toBe(1700000000000);
    expect(summary.endTime).toBe(1700000060000);
    expect(summary.duration).toBe(60000);
    expect(summary.platform).toBe('web');
    expect(summary.appName).toBe('TestApp');
    expect(summary.appVersion).toBe('1.0.0');
    expect(summary.eventCount).toBe(42);
    expect(summary.screenshotCount).toBe(5);
    expect(summary.size).toBe(1024);
    expect(summary.uploadedAt).toBe(1700000100000);
  });

  test('converts string values to numbers (R2 metadata format)', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-002',
      startTime: '1700000000000',
      endTime: '1700000060000',
      eventCount: '100',
      screenshotCount: '10',
      size: 2048,
      uploadedAt: '1700000100000',
    };

    const summary = toSessionSummary(meta);

    expect(summary.startTime).toBe(1700000000000);
    expect(summary.endTime).toBe(1700000060000);
    expect(summary.duration).toBe(60000);
    expect(summary.eventCount).toBe(100);
    expect(summary.screenshotCount).toBe(10);
    expect(summary.uploadedAt).toBe(1700000100000);
  });

  test('uses default values for missing optional fields', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-003',
      size: 512,
    };

    const summary = toSessionSummary(meta);

    expect(summary.startTime).toBe(0);
    expect(summary.endTime).toBeUndefined();
    expect(summary.duration).toBeUndefined();
    expect(summary.platform).toBe('web');
    expect(summary.appName).toBe('unknown');
    expect(summary.appVersion).toBe('unknown');
    expect(summary.eventCount).toBe(0);
    expect(summary.screenshotCount).toBe(0);
    expect(summary.uploadedAt).toBe(0);
  });

  test('computes duration as undefined when endTime is missing', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-004',
      startTime: 1700000000000,
      size: 100,
    };

    const summary = toSessionSummary(meta);
    expect(summary.duration).toBeUndefined();
  });

  test('handles endTime present with startTime of 0', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-005',
      startTime: 0,
      endTime: 5000,
      size: 100,
    };

    const summary = toSessionSummary(meta);
    // startTime is 0 (falsy), so duration should be undefined
    expect(summary.duration).toBeUndefined();
  });
});

// ============================================================================
// toSessionSummary - performance parsing
// ============================================================================

describe('toSessionSummary - performance', () => {
  test('passes through performance object directly', () => {
    const perfData = {
      webVitals: { lcp: 2500, cls: 0.1 },
      avgFps: 60,
    };
    const meta: SessionMetadataRecord = {
      id: 'sess-perf-1',
      size: 100,
      performance: perfData,
    };

    const summary = toSessionSummary(meta);
    expect(summary.performance).toEqual(perfData);
  });

  test('parses performance from JSON string', () => {
    const perfData = {
      webVitals: { lcp: 2500, cls: 0.1 },
      avgFps: 60,
    };
    const meta: SessionMetadataRecord = {
      id: 'sess-perf-2',
      size: 100,
      performance: JSON.stringify(perfData),
    };

    const summary = toSessionSummary(meta);
    expect(summary.performance).toEqual(perfData);
  });

  test('returns undefined performance for invalid JSON string', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-perf-3',
      size: 100,
      performance: '{invalid json',
    };

    const summary = toSessionSummary(meta);
    expect(summary.performance).toBeUndefined();
  });

  test('returns undefined performance when not provided', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-perf-4',
      size: 100,
    };

    const summary = toSessionSummary(meta);
    expect(summary.performance).toBeUndefined();
  });

  test('handles empty string for numeric fields (falls back to 0)', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-empty',
      startTime: '',
      eventCount: '',
      size: 100,
    } as unknown as SessionMetadataRecord;

    const summary = toSessionSummary(meta);
    expect(summary.startTime).toBe(0);
    expect(summary.eventCount).toBe(0);
  });

  test('handles NaN string values (falls back to 0)', () => {
    const meta: SessionMetadataRecord = {
      id: 'sess-nan',
      startTime: 'not-a-number',
      eventCount: 'abc',
      size: 100,
    } as unknown as SessionMetadataRecord;

    const summary = toSessionSummary(meta);
    expect(summary.startTime).toBe(0);
    expect(summary.eventCount).toBe(0);
  });
});
