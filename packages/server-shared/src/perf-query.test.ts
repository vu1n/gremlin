/**
 * Tests for performance query functions.
 *
 * Covers:
 * - getPerfValue: extracts metric values from SessionSummary
 * - filterSortPaginate: filtering, sorting, pagination, cursors
 * - computePerformanceAggregation: aggregates stats across summaries
 */

import { describe, test, expect } from 'bun:test';
import { getPerfValue, filterSortPaginate, computePerformanceAggregation } from './perf-query.ts';
import type { SessionSummary } from './types.ts';

// ============================================================================
// Helpers
// ============================================================================

function makeSummary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    startTime: 1700000000000,
    endTime: 1700000060000,
    duration: 60000,
    platform: 'web',
    appName: 'TestApp',
    appVersion: '1.0.0',
    eventCount: 10,
    screenshotCount: 2,
    size: 1024,
    uploadedAt: 1700000100000,
    ...overrides,
  };
}

// ============================================================================
// getPerfValue
// ============================================================================

describe('getPerfValue', () => {
  test('returns web vitals metrics', () => {
    const s = makeSummary({
      id: 's1',
      performance: {
        webVitals: { lcp: 2500, cls: 0.1, inp: 200, fcp: 1800, ttfb: 500 },
      },
    });

    expect(getPerfValue(s, 'lcp')).toBe(2500);
    expect(getPerfValue(s, 'cls')).toBe(0.1);
    expect(getPerfValue(s, 'inp')).toBe(200);
    expect(getPerfValue(s, 'fcp')).toBe(1800);
    expect(getPerfValue(s, 'ttfb')).toBe(500);
  });

  test('returns session-level perf metrics', () => {
    const s = makeSummary({
      id: 's1',
      performance: {
        avgFps: 60,
        minFps: 30,
        longTaskCount: 5,
        peakMemoryUsage: 1024000,
        pageLoadTime: 3000,
      },
    });

    expect(getPerfValue(s, 'avgFps')).toBe(60);
    expect(getPerfValue(s, 'minFps')).toBe(30);
    expect(getPerfValue(s, 'longTasks')).toBe(5);
    expect(getPerfValue(s, 'peakMemory')).toBe(1024000);
    expect(getPerfValue(s, 'pageLoad')).toBe(3000);
  });

  test('returns session metadata metrics', () => {
    const s = makeSummary({
      id: 's1',
      duration: 60000,
      eventCount: 42,
      startTime: 1700000000000,
    });

    expect(getPerfValue(s, 'duration')).toBe(60000);
    expect(getPerfValue(s, 'eventCount')).toBe(42);
    expect(getPerfValue(s, 'startTime')).toBe(1700000000000);
  });

  test('returns undefined when performance is missing', () => {
    const s = makeSummary({ id: 's1' });
    expect(getPerfValue(s, 'lcp')).toBeUndefined();
    expect(getPerfValue(s, 'avgFps')).toBeUndefined();
  });

  test('returns undefined when specific web vital is missing', () => {
    const s = makeSummary({
      id: 's1',
      performance: {
        webVitals: { lcp: 2500 },
      },
    });
    expect(getPerfValue(s, 'cls')).toBeUndefined();
    expect(getPerfValue(s, 'inp')).toBeUndefined();
  });
});

// ============================================================================
// filterSortPaginate - sorting
// ============================================================================

describe('filterSortPaginate', () => {
  test('sorts by startTime descending by default', () => {
    const summaries = [
      makeSummary({ id: 's1', startTime: 100 }),
      makeSummary({ id: 's3', startTime: 300 }),
      makeSummary({ id: 's2', startTime: 200 }),
    ];

    const result = filterSortPaginate(summaries, {});

    expect(result.sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
  });

  test('sorts ascending when order=asc', () => {
    const summaries = [
      makeSummary({ id: 's1', startTime: 100 }),
      makeSummary({ id: 's3', startTime: 300 }),
      makeSummary({ id: 's2', startTime: 200 }),
    ];

    const result = filterSortPaginate(summaries, { order: 'asc' });

    expect(result.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  test('sorts by custom sort key', () => {
    const summaries = [
      makeSummary({ id: 's1', eventCount: 50 }),
      makeSummary({ id: 's2', eventCount: 10 }),
      makeSummary({ id: 's3', eventCount: 100 }),
    ];

    const result = filterSortPaginate(summaries, { sort: 'eventCount', order: 'desc' });

    expect(result.sessions.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
  });

  test('places items with undefined sort values at the end', () => {
    const summaries = [
      makeSummary({ id: 's1', performance: { webVitals: { lcp: 2000 } } }),
      makeSummary({ id: 's2' }), // no performance
      makeSummary({ id: 's3', performance: { webVitals: { lcp: 1000 } } }),
    ];

    const result = filterSortPaginate(summaries, { sort: 'lcp', order: 'desc' });

    expect(result.sessions[0].id).toBe('s1');
    expect(result.sessions[1].id).toBe('s3');
    expect(result.sessions[2].id).toBe('s2'); // undefined goes last
  });

  // ============================================================================
  // filterSortPaginate - filtering
  // ============================================================================

  test('filters with gt operator', () => {
    const summaries = [
      makeSummary({ id: 's1', eventCount: 5, startTime: 100 }),
      makeSummary({ id: 's2', eventCount: 15, startTime: 200 }),
      makeSummary({ id: 's3', eventCount: 25, startTime: 300 }),
    ];

    const result = filterSortPaginate(summaries, {
      filters: [{ key: 'eventCount', op: 'gt', value: 10 }],
    });

    // Default sort: startTime desc -> s3, s2
    expect(result.sessions.map((s) => s.id)).toEqual(['s3', 's2']);
    expect(result.totalCount).toBe(2);
  });

  test('filters with lt operator', () => {
    const summaries = [
      makeSummary({ id: 's1', eventCount: 5, startTime: 100 }),
      makeSummary({ id: 's2', eventCount: 15, startTime: 200 }),
      makeSummary({ id: 's3', eventCount: 25, startTime: 300 }),
    ];

    const result = filterSortPaginate(summaries, {
      filters: [{ key: 'eventCount', op: 'lt', value: 20 }],
    });

    // Default sort: startTime desc -> s2, s1
    expect(result.sessions.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(result.totalCount).toBe(2);
  });

  test('applies multiple filters (AND logic)', () => {
    const summaries = [
      makeSummary({ id: 's1', eventCount: 50, duration: 1000, startTime: 100 }),
      makeSummary({ id: 's2', eventCount: 100, duration: 500, startTime: 200 }),
      makeSummary({ id: 's3', eventCount: 200, duration: 2000, startTime: 300 }),
    ];

    const result = filterSortPaginate(summaries, {
      filters: [
        { key: 'eventCount', op: 'gt', value: 30 },
        { key: 'duration', op: 'gt', value: 600 },
      ],
    });

    // s1: 50>30 & 1000>600 -> yes; s2: 100>30 & 500>600 -> no; s3: 200>30 & 2000>600 -> yes
    // Default sort: startTime desc -> s3, s1
    expect(result.sessions.map((s) => s.id)).toEqual(['s3', 's1']);
  });

  test('excludes items with undefined values when filtering', () => {
    const summaries = [
      makeSummary({ id: 's1', performance: { webVitals: { lcp: 2000 } } }),
      makeSummary({ id: 's2' }), // no performance -> lcp is undefined
    ];

    const result = filterSortPaginate(summaries, {
      filters: [{ key: 'lcp', op: 'gt', value: 1000 }],
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe('s1');
  });

  // ============================================================================
  // filterSortPaginate - pagination
  // ============================================================================

  test('limits results to specified limit', () => {
    const summaries = Array.from({ length: 10 }, (_, i) =>
      makeSummary({ id: `s${i}`, startTime: i })
    );

    const result = filterSortPaginate(summaries, { limit: 3 });

    expect(result.sessions).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(10);
  });

  test('uses default limit of 20', () => {
    const summaries = Array.from({ length: 25 }, (_, i) =>
      makeSummary({ id: `s${i}`, startTime: i })
    );

    const result = filterSortPaginate(summaries, {});

    expect(result.sessions).toHaveLength(20);
    expect(result.hasMore).toBe(true);
  });

  test('cursor-based pagination continues from the right position', () => {
    const summaries = Array.from({ length: 10 }, (_, i) =>
      makeSummary({ id: `s${i}`, startTime: i * 1000 })
    );

    const page1 = filterSortPaginate(summaries, { limit: 3 });
    expect(page1.sessions).toHaveLength(3);
    expect(page1.cursor).toBeDefined();

    const page2 = filterSortPaginate(summaries, { limit: 3, cursor: page1.cursor });
    expect(page2.sessions).toHaveLength(3);
    // page2 should start after page1's last item
    expect(page2.sessions[0].id).not.toBe(page1.sessions[2].id);
  });

  test('returns hasMore=false when no more results', () => {
    const summaries = [
      makeSummary({ id: 's1', startTime: 100 }),
      makeSummary({ id: 's2', startTime: 200 }),
    ];

    const result = filterSortPaginate(summaries, { limit: 5 });

    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeUndefined();
  });

  test('handles invalid cursor gracefully (starts from beginning)', () => {
    const summaries = [
      makeSummary({ id: 's1', startTime: 100 }),
      makeSummary({ id: 's2', startTime: 200 }),
    ];

    const result = filterSortPaginate(summaries, { cursor: 'nonexistent' });

    expect(result.sessions).toHaveLength(2);
  });
});

// ============================================================================
// computePerformanceAggregation
// ============================================================================

describe('computePerformanceAggregation', () => {
  test('handles empty summaries array', () => {
    const result = computePerformanceAggregation([]);

    expect(result.sessionCount).toBe(0);
    expect(result.sessionsWithPerf).toBe(0);
    expect(result.webVitals.lcp).toBeNull();
    expect(result.fps).toBeNull();
    expect(result.longTasks).toBeNull();
    expect(result.memory).toBeNull();
    expect(result.pageLoad).toBeNull();
  });

  test('aggregates web vitals across sessions', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { webVitals: { lcp: 1000, cls: 0.05, fcp: 800 } },
      }),
      makeSummary({
        id: 's2',
        performance: { webVitals: { lcp: 3000, cls: 0.2, fcp: 1500 } },
      }),
      makeSummary({
        id: 's3',
        performance: { webVitals: { lcp: 2000, cls: 0.1, fcp: 1200 } },
      }),
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.sessionCount).toBe(3);
    expect(result.sessionsWithPerf).toBe(3);
    expect(result.webVitals.lcp).not.toBeNull();
    expect(result.webVitals.lcp!.count).toBe(3);
    expect(result.webVitals.cls).not.toBeNull();
    expect(result.webVitals.cls!.count).toBe(3);
  });

  test('skips sessions without performance data', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { webVitals: { lcp: 2000 } },
      }),
      makeSummary({ id: 's2' }), // no performance
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.sessionCount).toBe(2);
    expect(result.sessionsWithPerf).toBe(1);
    expect(result.webVitals.lcp!.count).toBe(1);
  });

  test('aggregates FPS data', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { avgFps: 60, minFps: 30 },
      }),
      makeSummary({
        id: 's2',
        performance: { avgFps: 50, minFps: 20 },
      }),
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.fps).not.toBeNull();
    expect(result.fps!.avgFps).toBe(55); // (60+50)/2
    expect(result.fps!.minFps).toBe(20); // min of [30, 20]
    expect(result.fps!.count).toBe(2);
  });

  test('aggregates long task data', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { longTaskCount: 3, longTaskTotalDuration: 300 },
      }),
      makeSummary({
        id: 's2',
        performance: { longTaskCount: 7, longTaskTotalDuration: 700 },
      }),
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.longTasks).not.toBeNull();
    expect(result.longTasks!.totalCount).toBe(10);
    expect(result.longTasks!.totalDuration).toBe(1000);
    expect(result.longTasks!.avgPerSession).toBe(5);
    expect(result.longTasks!.count).toBe(2);
  });

  test('aggregates memory data', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { peakMemoryUsage: 100000 },
      }),
      makeSummary({
        id: 's2',
        performance: { peakMemoryUsage: 200000 },
      }),
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.memory).not.toBeNull();
    expect(result.memory!.avgPeak).toBe(150000);
    expect(result.memory!.maxPeak).toBe(200000);
    expect(result.memory!.count).toBe(2);
  });

  test('aggregates page load data', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { pageLoadTime: 2000 },
      }),
      makeSummary({
        id: 's2',
        performance: { pageLoadTime: 4000 },
      }),
      makeSummary({
        id: 's3',
        performance: { pageLoadTime: 3000 },
      }),
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.pageLoad).not.toBeNull();
    expect(result.pageLoad!.count).toBe(3);
  });

  test('returns null for metrics with no data points', () => {
    const summaries = [
      makeSummary({
        id: 's1',
        performance: { webVitals: { lcp: 2000 } },
        // No fps, no long tasks, no memory, no page load
      }),
    ];

    const result = computePerformanceAggregation(summaries);

    expect(result.fps).toBeNull();
    expect(result.longTasks).toBeNull();
    expect(result.memory).toBeNull();
    expect(result.pageLoad).toBeNull();
  });
});
