/**
 * Analytics rendering — console output formatters.
 *
 * Pure display logic. No data loading or computation.
 */

import type {
  AnalyticsSummaryResult,
  AnalyticsErrorsResult,
  AnalyticsPerformanceResult,
  MetricPercentiles,
} from './analytics-compute.ts';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

export function printSummary(result: AnalyticsSummaryResult): void {
  if (result.totalSessions === 0) {
    console.log('No analytics data found.');
    console.log('Run your app with `gremlin dev` to collect session data.');
    return;
  }

  console.log('');
  console.log('Analytics Summary');
  console.log('=================');
  console.log('');
  console.log(
    `Sessions:    ${result.totalSessions}`
  );
  console.log(
    `Events:      ${result.totalEvents} total (${result.avgEventsPerSession.toFixed(1)} avg/session)`
  );
  console.log(`Errors:      ${result.totalErrors} total`);
  console.log(`Avg Duration: ${formatDuration(result.avgDuration)}`);
  console.log('');

  console.log('Platforms:');
  for (const [plat, count] of Object.entries(result.platforms)) {
    console.log(`  ${plat.padEnd(12)} ${count} sessions`);
  }

  if (result.topScreens.length > 0) {
    console.log('');
    console.log('Top Screens:');
    for (let i = 0; i < result.topScreens.length; i++) {
      const { screen, count } = result.topScreens[i];
      console.log(`  ${i + 1}. ${screen} (${count} sessions)`);
    }
  }

  if (result.dateRange) {
    console.log('');
    console.log(`Date Range: ${result.dateRange.earliest} to ${result.dateRange.latest}`);
  }

  console.log('');
}

export function printErrors(result: AnalyticsErrorsResult): void {
  if (result.totalErrors === 0) {
    console.log('No errors found in analytics data.');
    return;
  }

  console.log('');
  console.log('Error Analysis');
  console.log('==============');
  console.log('');
  console.log(`Total Errors: ${result.totalErrors}`);

  if (Object.keys(result.errorsByType).length > 0) {
    console.log('');
    console.log('By Type:');
    for (const [type, count] of Object.entries(result.errorsByType)) {
      console.log(`  ${type.padEnd(12)} ${count}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('');
    console.log('Errors:');
    for (const err of result.errors) {
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
}

function printWebVitalsTable(vitals: AnalyticsPerformanceResult['webVitals']): void {
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
}

export function printPerformance(result: AnalyticsPerformanceResult): void {
  if (result.sessionsWithPerf === 0) {
    if (result.totalSessions === 0) {
      console.log('No sessions found. Run your app with `gremlin dev` to collect data.');
    } else {
      console.log(`Found ${result.totalSessions} sessions but none have performance data.`);
    }
    return;
  }

  console.log('');
  console.log('Performance Analytics');
  console.log('=====================');
  console.log('');
  console.log(`Sessions: ${result.totalSessions} total, ${result.sessionsWithPerf} with perf data`);
  console.log('');

  printWebVitalsTable(result.webVitals);

  if (result.fps) {
    console.log('');
    console.log(`FPS: avg=${result.fps.avg.toFixed(1)}, min=${result.fps.min.toFixed(0)}, p5=${result.fps.p5.toFixed(0)}`);
  }

  if (result.longTasks) {
    console.log(`Long Tasks: ${result.longTasks.total} total (${result.longTasks.avgPerSession.toFixed(1)} avg/session)`);
  }

  if (result.memory) {
    console.log(`Memory: avg=${result.memory.avg.toFixed(1)}MB, peak=${result.memory.peak.toFixed(1)}MB`);
  }

  console.log('');
}
