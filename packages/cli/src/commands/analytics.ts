/**
 * Analytics Command
 *
 * Aggregates and displays analytics from recorded sessions.
 * Reads analytics JSON files written by `gremlin dev` and session files
 * for detailed error analysis.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession, SessionPerformance } from '@gremlin/session';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsSummaryOptions extends OutputOptions {
  app?: string;
  since?: string;
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

export interface AnalyticsErrorsOptions extends OutputOptions {
  app?: string;
  since?: string;
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

interface AnalyticsFile {
  sessionId: string;
  duration: number;
  eventCount: number;
  errorCount: number;
  screens: string[];
  platform: string;
  deviceInfo: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Helpers
// ============================================================================

function loadAnalyticsFiles(options: { since?: string }): AnalyticsFile[] {
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
      // Skip unreadable files
    }
  }

  return results;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

// ============================================================================
// Summary Subcommand
// ============================================================================

export async function analyticsSummary(
  options: AnalyticsSummaryOptions
): Promise<AnalyticsSummaryResult> {
  const analytics = loadAnalyticsFiles(options);

  if (analytics.length === 0) {
    const result: AnalyticsSummaryResult = {
      totalSessions: 0,
      totalEvents: 0,
      totalErrors: 0,
      avgDuration: 0,
      avgEventsPerSession: 0,
      platforms: {},
      topScreens: [],
      dateRange: null,
    };

    if (output('analytics.summary', result, options)) return result;

    console.log('No analytics data found.');
    console.log('Run your app with `gremlin dev` to collect session data.');
    return result;
  }

  // Aggregate stats
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

  // Top screens sorted descending, limited to 10
  const topScreens = Object.entries(screenCounts)
    .map(([screen, count]) => ({ screen, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Date range
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

  const result: AnalyticsSummaryResult = {
    totalSessions,
    totalEvents,
    totalErrors,
    avgDuration,
    avgEventsPerSession,
    platforms,
    topScreens,
    dateRange,
  };

  if (output('analytics.summary', result, options)) return result;

  // Human-readable output
  console.log('');
  console.log('Analytics Summary');
  console.log('=================');
  console.log('');
  console.log(
    `Sessions:    ${totalSessions}`
  );
  console.log(
    `Events:      ${totalEvents} total (${avgEventsPerSession.toFixed(1)} avg/session)`
  );
  console.log(`Errors:      ${totalErrors} total`);
  console.log(`Avg Duration: ${formatDuration(avgDuration)}`);
  console.log('');

  console.log('Platforms:');
  for (const [plat, count] of Object.entries(platforms)) {
    console.log(`  ${plat.padEnd(12)} ${count} sessions`);
  }

  if (topScreens.length > 0) {
    console.log('');
    console.log('Top Screens:');
    for (let i = 0; i < topScreens.length; i++) {
      const { screen, count } = topScreens[i];
      console.log(`  ${i + 1}. ${screen} (${count} sessions)`);
    }
  }

  if (dateRange) {
    console.log('');
    console.log(`Date Range: ${dateRange.earliest} to ${dateRange.latest}`);
  }

  console.log('');

  return result;
}

// ============================================================================
// Errors Subcommand
// ============================================================================

export async function analyticsErrors(
  options: AnalyticsErrorsOptions
): Promise<AnalyticsErrorsResult> {
  const analytics = loadAnalyticsFiles(options);

  // Filter to sessions with errors
  const sessionsWithErrors = analytics.filter((a) => a.errorCount > 0);

  if (sessionsWithErrors.length === 0) {
    const result: AnalyticsErrorsResult = {
      totalErrors: 0,
      errorsByType: {},
      errors: [],
    };

    if (output('analytics.errors', result, options)) return result;

    console.log('No errors found in analytics data.');
    return result;
  }

  // Read session files for detailed error info
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

  const totalErrors = errors.length;

  const result: AnalyticsErrorsResult = {
    totalErrors,
    errorsByType,
    errors,
  };

  if (output('analytics.errors', result, options)) return result;

  // Human-readable output
  console.log('');
  console.log('Error Analysis');
  console.log('==============');
  console.log('');
  console.log(`Total Errors: ${totalErrors}`);

  if (Object.keys(errorsByType).length > 0) {
    console.log('');
    console.log('By Type:');
    for (const [type, count] of Object.entries(errorsByType)) {
      console.log(`  ${type.padEnd(12)} ${count}`);
    }
  }

  if (errors.length > 0) {
    console.log('');
    console.log('Errors:');
    for (const err of errors) {
      const shortId = err.sessionId.slice(0, 8);
      const fatalTag = err.fatal ? ' (fatal)' : '';
      const msg =
        err.message.length > 60
          ? err.message.slice(0, 60) + '...'
          : err.message;
      console.log(`  [${shortId}] ${err.errorType}${fatalTag}: ${msg}`);
    }
  }

  console.log('');

  return result;
}

// ============================================================================
// Performance Subcommand
// ============================================================================

export interface AnalyticsPerformanceOptions extends OutputOptions {
  app?: string;
  since?: string;
}

type CwvRating = 'good' | 'needs-improvement' | 'poor';

interface MetricPercentiles {
  p50: number;
  p75: number;
  p95: number;
  rating: CwvRating;
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

// Core Web Vitals thresholds: [good, needs-improvement] boundary
const CWV_THRESHOLDS: Record<string, [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function rateMetric(name: string, p75: number): CwvRating {
  const thresholds = CWV_THRESHOLDS[name];
  if (!thresholds) return 'good';
  if (p75 <= thresholds[0]) return 'good';
  if (p75 <= thresholds[1]) return 'needs-improvement';
  return 'poor';
}

function computePercentiles(values: number[], metricName: string): MetricPercentiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p95 = percentile(sorted, 95);
  return { p50, p75, p95, rating: rateMetric(metricName, p75) };
}

export async function analyticsPerformance(
  options: AnalyticsPerformanceOptions
): Promise<AnalyticsPerformanceResult> {
  const sessionsDir = '.gremlin/sessions';

  if (!existsSync(sessionsDir)) {
    const result: AnalyticsPerformanceResult = {
      totalSessions: 0,
      sessionsWithPerf: 0,
      webVitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
      fps: null,
      longTasks: null,
      memory: null,
    };
    if (output('analytics.performance', result, options)) return result;
    console.log('No sessions found. Run your app with `gremlin dev` to collect data.');
    return result;
  }

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
      // Skip unreadable files
    }
  }

  if (perfData.length === 0) {
    const result: AnalyticsPerformanceResult = {
      totalSessions,
      sessionsWithPerf: 0,
      webVitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
      fps: null,
      longTasks: null,
      memory: null,
    };
    if (output('analytics.performance', result, options)) return result;
    console.log(`Found ${totalSessions} sessions but none have performance data.`);
    return result;
  }

  // Collect values
  const lcpValues: number[] = [];
  const clsValues: number[] = [];
  const inpValues: number[] = [];
  const fcpValues: number[] = [];
  const ttfbValues: number[] = [];
  const fpsValues: number[] = [];
  const minFpsValues: number[] = [];
  const longTaskCounts: number[] = [];
  const memoryValues: number[] = [];

  for (const p of perfData) {
    if (p.webVitals?.lcp !== undefined) lcpValues.push(p.webVitals.lcp);
    if (p.webVitals?.cls !== undefined) clsValues.push(p.webVitals.cls);
    if (p.webVitals?.inp !== undefined) inpValues.push(p.webVitals.inp);
    if (p.webVitals?.fcp !== undefined) fcpValues.push(p.webVitals.fcp);
    if (p.webVitals?.ttfb !== undefined) ttfbValues.push(p.webVitals.ttfb);
    if (p.avgFps !== undefined) fpsValues.push(p.avgFps);
    if (p.minFps !== undefined) minFpsValues.push(p.minFps);
    if (p.longTaskCount !== undefined) longTaskCounts.push(p.longTaskCount);
    if (p.peakMemoryUsage !== undefined) memoryValues.push(p.peakMemoryUsage);
  }

  // FPS stats
  let fps: AnalyticsPerformanceResult['fps'] = null;
  if (fpsValues.length > 0) {
    const avg = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
    const min = minFpsValues.length > 0 ? Math.min(...minFpsValues) : Math.min(...fpsValues);
    const sortedFps = [...fpsValues].sort((a, b) => a - b);
    fps = { avg, min, p5: percentile(sortedFps, 5) };
  }

  // Long tasks stats
  let longTasks: AnalyticsPerformanceResult['longTasks'] = null;
  if (longTaskCounts.length > 0) {
    const total = longTaskCounts.reduce((a, b) => a + b, 0);
    longTasks = { total, avgPerSession: total / longTaskCounts.length };
  }

  // Memory stats
  let memory: AnalyticsPerformanceResult['memory'] = null;
  if (memoryValues.length > 0) {
    const avg = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;
    const peak = Math.max(...memoryValues);
    memory = { avg, peak };
  }

  const result: AnalyticsPerformanceResult = {
    totalSessions,
    sessionsWithPerf: perfData.length,
    webVitals: {
      lcp: computePercentiles(lcpValues, 'lcp'),
      cls: computePercentiles(clsValues, 'cls'),
      inp: computePercentiles(inpValues, 'inp'),
      fcp: computePercentiles(fcpValues, 'fcp'),
      ttfb: computePercentiles(ttfbValues, 'ttfb'),
    },
    fps,
    longTasks,
    memory,
  };

  if (output('analytics.performance', result, options)) return result;

  // Human-readable output
  console.log('');
  console.log('Performance Analytics');
  console.log('=====================');
  console.log('');
  console.log(`Sessions: ${totalSessions} total, ${perfData.length} with perf data`);
  console.log('');

  // Web Vitals table
  const vitals = result.webVitals;
  const vitalNames: [string, MetricPercentiles | null, string][] = [
    ['LCP', vitals.lcp, 'ms'],
    ['CLS', vitals.cls, ''],
    ['INP', vitals.inp, 'ms'],
    ['FCP', vitals.fcp, 'ms'],
    ['TTFB', vitals.ttfb, 'ms'],
  ];

  console.log('Web Vitals:');
  console.log(`  ${'Metric'.padEnd(8)} ${'p50'.padEnd(10)} ${'p75'.padEnd(10)} ${'p95'.padEnd(10)} Rating`);
  console.log(`  ${'------'.padEnd(8)} ${'---'.padEnd(10)} ${'---'.padEnd(10)} ${'---'.padEnd(10)} ------`);

  for (const [name, data, unit] of vitalNames) {
    if (!data) continue;
    const fmt = (v: number) => {
      if (unit === 'ms') return `${v.toFixed(0)}ms`;
      return v.toFixed(3);
    };
    const ratingLabel = data.rating === 'good' ? 'Good' : data.rating === 'needs-improvement' ? 'Needs Work' : 'Poor';
    console.log(`  ${name.padEnd(8)} ${fmt(data.p50).padEnd(10)} ${fmt(data.p75).padEnd(10)} ${fmt(data.p95).padEnd(10)} ${ratingLabel}`);
  }

  if (fps) {
    console.log('');
    console.log(`FPS: avg=${fps.avg.toFixed(1)}, min=${fps.min.toFixed(0)}, p5=${fps.p5.toFixed(0)}`);
  }

  if (longTasks) {
    console.log(`Long Tasks: ${longTasks.total} total (${longTasks.avgPerSession.toFixed(1)} avg/session)`);
  }

  if (memory) {
    console.log(`Memory: avg=${memory.avg.toFixed(1)}MB, peak=${memory.peak.toFixed(1)}MB`);
  }

  console.log('');

  return result;
}
