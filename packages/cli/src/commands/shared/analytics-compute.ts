/**
 * Analytics computation — pure data-in / data-out functions.
 *
 * No console output, no side effects. All rendering lives in analytics-render.ts,
 * and orchestration stays in commands/analytics.ts.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession, SessionPerformance } from '@gremlin/session';
import { percentile } from '../../stats.ts';

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsFile {
  sessionId: string;
  duration: number;
  eventCount: number;
  errorCount: number;
  screens: string[];
  platform: string;
  deviceInfo: Record<string, unknown>;
  timestamp: string;
}

export type CwvRating = 'good' | 'needs-improvement' | 'poor';

export interface MetricPercentiles {
  p50: number;
  p75: number;
  p95: number;
  rating: CwvRating;
}

export interface AnalyticsSummaryResult {
  totalSessions: number;
  totalEvents: number;
  totalErrors: number;
  avgDuration: number;
  avgEventsPerSession: number;
  platforms: Record<string, number>;
  topScreens: { screen: string; count: number }[];
  dateRange: { earliest: string; latest: string } | null;
}

export interface AnalyticsErrorsResult {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errors: {
    sessionId: string;
    message: string;
    errorType: string;
    fatal: boolean;
    timestamp: string;
  }[];
}

export interface AnalyticsPerformanceResult {
  totalSessions: number;
  sessionsWithPerf: number;
  webVitals: {
    lcp: MetricPercentiles | null;
    cls: MetricPercentiles | null;
    inp: MetricPercentiles | null;
    fcp: MetricPercentiles | null;
    ttfb: MetricPercentiles | null;
  };
  fps: { avg: number; min: number; p5: number } | null;
  longTasks: { total: number; avgPerSession: number } | null;
  memory: { avg: number; peak: number } | null;
}

// ============================================================================
// Data loading
// ============================================================================

export function loadAnalyticsFiles(options: { since?: string }): AnalyticsFile[] {
  const analyticsDir = '.gremlin/analytics';

  if (!existsSync(analyticsDir)) {
    return [];
  }

  const files = readdirSync(analyticsDir).filter((f) => f.endsWith('.json'));
  const results: AnalyticsFile[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(analyticsDir, file), 'utf-8');
      const data = JSON.parse(content) as AnalyticsFile;

      if (options.since) {
        const sinceDate = new Date(options.since);
        const fileDate = new Date(data.timestamp);
        if (fileDate < sinceDate) continue;
      }

      results.push(data);
    } catch {
      // Skip unreadable analytics files
    }
  }

  return results;
}

export function loadPerfData(
  options: { since?: string; app?: string }
): { totalSessions: number; perfData: SessionPerformance[] } {
  const sessionsDir = '.gremlin/sessions';
  const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  const perfData: SessionPerformance[] = [];
  let totalSessions = 0;

  const sinceDate = options.since ? new Date(options.since).getTime() : 0;

  for (const file of files) {
    try {
      const content = readFileSync(join(sessionsDir, file), 'utf-8');
      const session = JSON.parse(content) as GremlinSession;

      if (options.app && session.header?.app?.name !== options.app) continue;
      if (sinceDate && (session.header?.startTime ?? 0) < sinceDate) continue;

      totalSessions++;
      if (session.performance) {
        perfData.push(session.performance);
      }
    } catch {
      // Skip unreadable session files
    }
  }

  return { totalSessions, perfData };
}

// ============================================================================
// Computation — pure functions
// ============================================================================

// Core Web Vitals thresholds: [good, needs-improvement] boundary
const CWV_THRESHOLDS: Record<string, [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
};

function rateMetric(name: string, p75: number): CwvRating {
  const thresholds = CWV_THRESHOLDS[name];
  if (!thresholds) return 'good';
  if (p75 <= thresholds[0]) return 'good';
  if (p75 <= thresholds[1]) return 'needs-improvement';
  return 'poor';
}

export function computePercentiles(values: number[], metricName: string): MetricPercentiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p95 = percentile(sorted, 95);
  return { p50, p75, p95, rating: rateMetric(metricName, p75) };
}

export function computeSummary(analytics: AnalyticsFile[]): AnalyticsSummaryResult {
  if (analytics.length === 0) {
    return {
      totalSessions: 0,
      totalEvents: 0,
      totalErrors: 0,
      avgDuration: 0,
      avgEventsPerSession: 0,
      platforms: {},
      topScreens: [],
      dateRange: null,
    };
  }

  let totalEvents = 0;
  let totalErrors = 0;
  let totalDuration = 0;
  const platforms: Record<string, number> = {};
  const screenCounts: Record<string, number> = {};
  const timestamps: string[] = [];

  for (const entry of analytics) {
    totalEvents += entry.eventCount;
    totalErrors += entry.errorCount;
    totalDuration += entry.duration;

    const plat = entry.platform || 'unknown';
    platforms[plat] = (platforms[plat] || 0) + 1;

    for (const screen of entry.screens) {
      screenCounts[screen] = (screenCounts[screen] || 0) + 1;
    }

    if (entry.timestamp) {
      timestamps.push(entry.timestamp);
    }
  }

  const topScreens = Object.entries(screenCounts)
    .map(([screen, count]) => ({ screen, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  let dateRange: { earliest: string; latest: string } | null = null;
  if (timestamps.length > 0) {
    const sorted = timestamps
      .map((t) => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime());
    dateRange = {
      earliest: sorted[0].toISOString().split('T')[0],
      latest: sorted[sorted.length - 1].toISOString().split('T')[0],
    };
  }

  const totalSessions = analytics.length;
  const avgDuration = totalDuration / totalSessions;
  const avgEventsPerSession = totalEvents / totalSessions;

  return {
    totalSessions,
    totalEvents,
    totalErrors,
    avgDuration,
    avgEventsPerSession,
    platforms,
    topScreens,
    dateRange,
  };
}

export function computeErrors(sessionsWithErrors: AnalyticsFile[]): AnalyticsErrorsResult {
  const errorsByType: Record<string, number> = {};
  const errors: AnalyticsErrorsResult['errors'] = [];

  for (const entry of sessionsWithErrors) {
    const sessionPath = join('.gremlin/sessions', `${entry.sessionId}.json`);
    if (!existsSync(sessionPath)) continue;

    try {
      const content = readFileSync(sessionPath, 'utf-8');
      const session = JSON.parse(content);
      const events = session.events || [];

      for (const event of events) {
        if (event.data?.kind === 'error') {
          const errorType = event.data.errorType || 'unknown';
          errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;

          errors.push({
            sessionId: entry.sessionId,
            message: event.data.message || 'Unknown error',
            errorType,
            fatal: event.data.fatal ?? false,
            timestamp: entry.timestamp,
          });
        }
      }
    } catch {
      // Skip unreadable session files
    }
  }

  return { totalErrors: errors.length, errorsByType, errors };
}

interface CollectedPerfValues {
  lcpValues: number[];
  clsValues: number[];
  inpValues: number[];
  fcpValues: number[];
  ttfbValues: number[];
  fpsValues: number[];
  minFpsValues: number[];
  longTaskCounts: number[];
  memoryValues: number[];
}

function collectPerfValues(perfData: SessionPerformance[]): CollectedPerfValues {
  const result: CollectedPerfValues = {
    lcpValues: [], clsValues: [], inpValues: [], fcpValues: [], ttfbValues: [],
    fpsValues: [], minFpsValues: [], longTaskCounts: [], memoryValues: [],
  };

  for (const p of perfData) {
    if (p.webVitals?.lcp !== undefined) result.lcpValues.push(p.webVitals.lcp);
    if (p.webVitals?.cls !== undefined) result.clsValues.push(p.webVitals.cls);
    if (p.webVitals?.inp !== undefined) result.inpValues.push(p.webVitals.inp);
    if (p.webVitals?.fcp !== undefined) result.fcpValues.push(p.webVitals.fcp);
    if (p.webVitals?.ttfb !== undefined) result.ttfbValues.push(p.webVitals.ttfb);
    if (p.avgFps !== undefined) result.fpsValues.push(p.avgFps);
    if (p.minFps !== undefined) result.minFpsValues.push(p.minFps);
    if (p.longTaskCount !== undefined) result.longTaskCounts.push(p.longTaskCount);
    if (p.peakMemoryUsage !== undefined) result.memoryValues.push(p.peakMemoryUsage);
  }

  return result;
}

function computeFpsStats(
  fpsValues: number[],
  minFpsValues: number[]
): AnalyticsPerformanceResult['fps'] {
  if (fpsValues.length === 0) return null;
  const avg = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
  const min = minFpsValues.length > 0 ? Math.min(...minFpsValues) : Math.min(...fpsValues);
  const sortedFps = [...fpsValues].sort((a, b) => a - b);
  return { avg, min, p5: percentile(sortedFps, 5) };
}

function computeLongTaskStats(
  longTaskCounts: number[]
): AnalyticsPerformanceResult['longTasks'] {
  if (longTaskCounts.length === 0) return null;
  const total = longTaskCounts.reduce((a, b) => a + b, 0);
  return { total, avgPerSession: total / longTaskCounts.length };
}

function computeMemoryStats(
  memoryValues: number[]
): AnalyticsPerformanceResult['memory'] {
  if (memoryValues.length === 0) return null;
  const avg = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;
  const peak = Math.max(...memoryValues);
  return { avg, peak };
}

export function computePerformance(
  totalSessions: number,
  perfData: SessionPerformance[]
): AnalyticsPerformanceResult {
  if (perfData.length === 0) {
    return emptyPerfResult(totalSessions);
  }

  const values = collectPerfValues(perfData);

  return {
    totalSessions,
    sessionsWithPerf: perfData.length,
    webVitals: {
      lcp: computePercentiles(values.lcpValues, 'lcp'),
      cls: computePercentiles(values.clsValues, 'cls'),
      inp: computePercentiles(values.inpValues, 'inp'),
      fcp: computePercentiles(values.fcpValues, 'fcp'),
      ttfb: computePercentiles(values.ttfbValues, 'ttfb'),
    },
    fps: computeFpsStats(values.fpsValues, values.minFpsValues),
    longTasks: computeLongTaskStats(values.longTaskCounts),
    memory: computeMemoryStats(values.memoryValues),
  };
}

export function emptyPerfResult(totalSessions: number): AnalyticsPerformanceResult {
  return {
    totalSessions,
    sessionsWithPerf: 0,
    webVitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
    fps: null,
    longTasks: null,
    memory: null,
  };
}
