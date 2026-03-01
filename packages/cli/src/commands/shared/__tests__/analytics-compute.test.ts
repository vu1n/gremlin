import { describe, test, expect } from 'bun:test';
import {
  computeSummary,
  computePercentiles,
  computePerformance,
  emptyPerfResult,
  type AnalyticsFile,
} from '../analytics-compute.ts';
import type { SessionPerformance } from '@gremlin/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnalyticsFile(overrides?: Partial<AnalyticsFile>): AnalyticsFile {
  return {
    sessionId: 'sess-1',
    duration: 5000,
    eventCount: 10,
    errorCount: 0,
    screens: ['/home'],
    platform: 'web',
    deviceInfo: {},
    timestamp: '2025-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computePercentiles
// ---------------------------------------------------------------------------

describe('computePercentiles', () => {
  test('returns null for empty values', () => {
    expect(computePercentiles([], 'lcp')).toBeNull();
  });

  test('computes p50, p75, p95 for LCP values', () => {
    const values = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500];
    const result = computePercentiles(values, 'lcp');
    expect(result).not.toBeNull();
    expect(result!.p50).toBeDefined();
    expect(result!.p75).toBeDefined();
    expect(result!.p95).toBeDefined();
    expect(result!.rating).toBeDefined();
  });

  test('rates LCP as good when p75 <= 2500', () => {
    const values = [500, 1000, 1500, 2000];
    const result = computePercentiles(values, 'lcp');
    expect(result!.rating).toBe('good');
  });

  test('rates LCP as needs-improvement when p75 between 2500 and 4000', () => {
    // p75 for [1000, 2000, 3000, 4000] => sorted, ceil(0.75*4)-1 = 2 => 3000
    const values = [1000, 2000, 3000, 4000];
    const result = computePercentiles(values, 'lcp');
    expect(result!.rating).toBe('needs-improvement');
  });

  test('rates LCP as poor when p75 > 4000', () => {
    const values = [3000, 4000, 5000, 6000];
    const result = computePercentiles(values, 'lcp');
    expect(result!.rating).toBe('poor');
  });

  test('rates CLS correctly (thresholds: 0.1 / 0.25)', () => {
    // All very small -> good
    const goodValues = [0.01, 0.02, 0.05, 0.08];
    expect(computePercentiles(goodValues, 'cls')!.rating).toBe('good');

    // p75 around 0.15 -> needs-improvement
    const midValues = [0.05, 0.1, 0.15, 0.2];
    expect(computePercentiles(midValues, 'cls')!.rating).toBe('needs-improvement');

    // p75 > 0.25 -> poor
    const poorValues = [0.1, 0.2, 0.3, 0.4];
    expect(computePercentiles(poorValues, 'cls')!.rating).toBe('poor');
  });

  test('returns good rating for unknown metric names', () => {
    const values = [100, 200, 300];
    const result = computePercentiles(values, 'unknown-metric');
    expect(result!.rating).toBe('good');
  });

  test('handles single value', () => {
    const result = computePercentiles([2000], 'lcp');
    expect(result!.p50).toBe(2000);
    expect(result!.p75).toBe(2000);
    expect(result!.p95).toBe(2000);
    expect(result!.rating).toBe('good');
  });
});

// ---------------------------------------------------------------------------
// computeSummary
// ---------------------------------------------------------------------------

describe('computeSummary', () => {
  test('returns zero defaults for empty analytics', () => {
    const result = computeSummary([]);
    expect(result.totalSessions).toBe(0);
    expect(result.totalEvents).toBe(0);
    expect(result.totalErrors).toBe(0);
    expect(result.avgDuration).toBe(0);
    expect(result.avgEventsPerSession).toBe(0);
    expect(result.platforms).toEqual({});
    expect(result.topScreens).toEqual([]);
    expect(result.dateRange).toBeNull();
  });

  test('computes totals from a single session', () => {
    const entry = makeAnalyticsFile({
      duration: 3000,
      eventCount: 5,
      errorCount: 2,
      screens: ['/home', '/about'],
      platform: 'web',
    });
    const result = computeSummary([entry]);
    expect(result.totalSessions).toBe(1);
    expect(result.totalEvents).toBe(5);
    expect(result.totalErrors).toBe(2);
    expect(result.avgDuration).toBe(3000);
    expect(result.avgEventsPerSession).toBe(5);
    expect(result.platforms).toEqual({ web: 1 });
  });

  test('aggregates multiple sessions correctly', () => {
    const entries = [
      makeAnalyticsFile({ sessionId: 'a', duration: 2000, eventCount: 4, errorCount: 1, platform: 'web', screens: ['/home'] }),
      makeAnalyticsFile({ sessionId: 'b', duration: 6000, eventCount: 8, errorCount: 3, platform: 'ios', screens: ['/home', '/profile'] }),
      makeAnalyticsFile({ sessionId: 'c', duration: 4000, eventCount: 6, errorCount: 0, platform: 'web', screens: ['/profile'] }),
    ];
    const result = computeSummary(entries);
    expect(result.totalSessions).toBe(3);
    expect(result.totalEvents).toBe(18);
    expect(result.totalErrors).toBe(4);
    expect(result.avgDuration).toBe(4000);
    expect(result.avgEventsPerSession).toBe(6);
    expect(result.platforms).toEqual({ web: 2, ios: 1 });
  });

  test('computes top screens sorted by frequency', () => {
    const entries = [
      makeAnalyticsFile({ screens: ['/home', '/about', '/contact'] }),
      makeAnalyticsFile({ screens: ['/home', '/about'] }),
      makeAnalyticsFile({ screens: ['/home'] }),
    ];
    const result = computeSummary(entries);
    expect(result.topScreens[0]).toEqual({ screen: '/home', count: 3 });
    expect(result.topScreens[1]).toEqual({ screen: '/about', count: 2 });
    expect(result.topScreens[2]).toEqual({ screen: '/contact', count: 1 });
  });

  test('limits topScreens to 10', () => {
    const screens = Array.from({ length: 15 }, (_, i) => `/page-${i}`);
    const entry = makeAnalyticsFile({ screens });
    const result = computeSummary([entry]);
    expect(result.topScreens.length).toBe(10);
  });

  test('computes date range from timestamps', () => {
    const entries = [
      makeAnalyticsFile({ timestamp: '2025-03-01T10:00:00Z' }),
      makeAnalyticsFile({ timestamp: '2025-06-15T14:30:00Z' }),
      makeAnalyticsFile({ timestamp: '2025-01-10T08:00:00Z' }),
    ];
    const result = computeSummary(entries);
    expect(result.dateRange).not.toBeNull();
    expect(result.dateRange!.earliest).toBe('2025-01-10');
    expect(result.dateRange!.latest).toBe('2025-06-15');
  });

  test('defaults unknown platform', () => {
    const entry = makeAnalyticsFile({ platform: '' });
    const result = computeSummary([entry]);
    expect(result.platforms).toEqual({ unknown: 1 });
  });
});

// ---------------------------------------------------------------------------
// computePerformance
// ---------------------------------------------------------------------------

describe('computePerformance', () => {
  test('returns empty result when perfData is empty', () => {
    const result = computePerformance(5, []);
    expect(result).toEqual(emptyPerfResult(5));
    expect(result.totalSessions).toBe(5);
    expect(result.sessionsWithPerf).toBe(0);
    expect(result.webVitals.lcp).toBeNull();
    expect(result.fps).toBeNull();
    expect(result.longTasks).toBeNull();
    expect(result.memory).toBeNull();
  });

  test('computes web vitals from perf data', () => {
    const perfData: SessionPerformance[] = [
      { webVitals: { lcp: 2000, cls: 0.05, fcp: 1500 } },
      { webVitals: { lcp: 2500, cls: 0.08, fcp: 1800 } },
      { webVitals: { lcp: 3000, cls: 0.12, fcp: 2000 } },
    ];
    const result = computePerformance(3, perfData);
    expect(result.sessionsWithPerf).toBe(3);
    expect(result.webVitals.lcp).not.toBeNull();
    expect(result.webVitals.cls).not.toBeNull();
    expect(result.webVitals.fcp).not.toBeNull();
    // inp and ttfb not provided
    expect(result.webVitals.inp).toBeNull();
    expect(result.webVitals.ttfb).toBeNull();
  });

  test('computes FPS stats', () => {
    const perfData: SessionPerformance[] = [
      { avgFps: 60, minFps: 30 },
      { avgFps: 55, minFps: 20 },
      { avgFps: 58, minFps: 25 },
    ];
    const result = computePerformance(3, perfData);
    expect(result.fps).not.toBeNull();
    expect(result.fps!.avg).toBeCloseTo((60 + 55 + 58) / 3);
    expect(result.fps!.min).toBe(20);
  });

  test('computes long task stats', () => {
    const perfData: SessionPerformance[] = [
      { longTaskCount: 5 },
      { longTaskCount: 10 },
      { longTaskCount: 15 },
    ];
    const result = computePerformance(3, perfData);
    expect(result.longTasks).not.toBeNull();
    expect(result.longTasks!.total).toBe(30);
    expect(result.longTasks!.avgPerSession).toBe(10);
  });

  test('computes memory stats', () => {
    const perfData: SessionPerformance[] = [
      { peakMemoryUsage: 100 },
      { peakMemoryUsage: 200 },
      { peakMemoryUsage: 300 },
    ];
    const result = computePerformance(3, perfData);
    expect(result.memory).not.toBeNull();
    expect(result.memory!.avg).toBe(200);
    expect(result.memory!.peak).toBe(300);
  });

  test('handles mixed perf data (some fields missing)', () => {
    const perfData: SessionPerformance[] = [
      { webVitals: { lcp: 2000 }, avgFps: 60 },
      { peakMemoryUsage: 150 },
      { longTaskCount: 3, avgFps: 55 },
    ];
    const result = computePerformance(5, perfData);
    expect(result.totalSessions).toBe(5);
    expect(result.sessionsWithPerf).toBe(3);
    expect(result.webVitals.lcp).not.toBeNull();
    expect(result.fps).not.toBeNull();
    expect(result.longTasks).not.toBeNull();
    expect(result.memory).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// emptyPerfResult
// ---------------------------------------------------------------------------

describe('emptyPerfResult', () => {
  test('returns all-null web vitals', () => {
    const result = emptyPerfResult(10);
    expect(result.totalSessions).toBe(10);
    expect(result.sessionsWithPerf).toBe(0);
    for (const key of ['lcp', 'cls', 'inp', 'fcp', 'ttfb'] as const) {
      expect(result.webVitals[key]).toBeNull();
    }
  });
});
