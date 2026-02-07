/**
 * Analytics Command
 *
 * Aggregates and displays analytics from recorded sessions.
 * Reads analytics JSON files written by `gremlin dev` and session files
 * for detailed error analysis.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
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
