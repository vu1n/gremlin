/**
 * Analytics Command
 *
 * Aggregates and displays analytics from recorded sessions.
 * Orchestration only — computation in shared/analytics-compute.ts,
 * rendering in shared/analytics-render.ts.
 */

import { existsSync } from 'fs';
import { output, type OutputOptions } from '../output.ts';
import {
  loadAnalyticsFiles,
  loadPerfData,
  computeSummary,
  computeErrors,
  computePerformance,
  emptyPerfResult,
  type AnalyticsSummaryResult,
  type AnalyticsErrorsResult,
  type AnalyticsPerformanceResult,
} from './shared/analytics-compute.ts';
import {
  printSummary,
  printErrors,
  printPerformance,
} from './shared/analytics-render.ts';

// Re-export result types for consumers
export type { AnalyticsSummaryResult, AnalyticsErrorsResult, AnalyticsPerformanceResult };

interface AnalyticsSummaryOptions extends OutputOptions {
  since?: string;
}

interface AnalyticsErrorsOptions extends OutputOptions {
  since?: string;
}

interface AnalyticsPerformanceOptions extends OutputOptions {
  app?: string;
  since?: string;
}

export function analyticsSummary(
  options: AnalyticsSummaryOptions
): AnalyticsSummaryResult {
  const analytics = loadAnalyticsFiles(options);
  const result = computeSummary(analytics);

  if (output('analytics.summary', result, options)) return result;
  printSummary(result);
  return result;
}

export function analyticsErrors(
  options: AnalyticsErrorsOptions
): AnalyticsErrorsResult {
  const analytics = loadAnalyticsFiles(options);
  const sessionsWithErrors = analytics.filter((a) => a.errorCount > 0);

  if (sessionsWithErrors.length === 0) {
    const result: AnalyticsErrorsResult = {
      totalErrors: 0,
      errorsByType: {},
      errors: [],
    };

    if (output('analytics.errors', result, options)) return result;
    printErrors(result);
    return result;
  }

  const result = computeErrors(sessionsWithErrors);
  if (output('analytics.errors', result, options)) return result;
  printErrors(result);
  return result;
}

export function analyticsPerformance(
  options: AnalyticsPerformanceOptions
): AnalyticsPerformanceResult {
  const sessionsDir = '.gremlin/sessions';

  if (!existsSync(sessionsDir)) {
    const result = emptyPerfResult(0);
    if (output('analytics.performance', result, options)) return result;
    printPerformance(result);
    return result;
  }

  const { totalSessions, perfData } = loadPerfData(options);
  const result = computePerformance(totalSessions, perfData);

  if (output('analytics.performance', result, options)) return result;
  printPerformance(result);
  return result;
}
