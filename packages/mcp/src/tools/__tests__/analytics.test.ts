/**
 * Tests for MCP analytics tool argument building.
 *
 * Covers:
 * - gremlin_analytics_summary: arg building with optional --since flag
 * - gremlin_analytics_performance: arg building with optional --app and --since flags
 * - Tool handler response shaping for analytics data
 *
 * Tests the argument construction logic without spawning CLI processes.
 */

import { describe, test, expect } from 'bun:test';
import {
  textResult,
  errorResult,
  parseCliJsonEnvelope,
  type CliResult,
  type CliEnvelope,
} from '../helpers.ts';

// ============================================================================
// Helpers - replicate the arg-building logic from analytics.ts
// ============================================================================

function buildAnalyticsSummaryArgs(params: { since?: string }): string[] {
  const args = ['analytics', 'summary'];
  if (params.since) args.push('--since', String(params.since));
  return args;
}

function buildAnalyticsPerformanceArgs(params: {
  app?: string;
  since?: string;
}): string[] {
  const args = ['analytics', 'performance'];
  if (params.app) args.push('--app', String(params.app));
  if (params.since) args.push('--since', String(params.since));
  return args;
}

// ============================================================================
// gremlin_analytics_summary
// ============================================================================

describe('gremlin_analytics_summary args', () => {
  test('builds minimal args with no options', () => {
    const args = buildAnalyticsSummaryArgs({});
    expect(args).toEqual(['analytics', 'summary']);
  });

  test('includes --since flag when provided', () => {
    const args = buildAnalyticsSummaryArgs({ since: '2024-01-15' });
    expect(args).toContain('--since');
    expect(args).toContain('2024-01-15');
  });

  test('does not include --since when undefined', () => {
    const args = buildAnalyticsSummaryArgs({ since: undefined });
    expect(args).not.toContain('--since');
    expect(args.length).toBe(2);
  });

  test('does not include --since when empty string', () => {
    const args = buildAnalyticsSummaryArgs({ since: '' });
    // Empty string is falsy, so --since is not added
    expect(args).not.toContain('--since');
  });

  test('handles ISO date string for since', () => {
    const args = buildAnalyticsSummaryArgs({
      since: '2024-06-15T00:00:00.000Z',
    });
    expect(args).toEqual([
      'analytics',
      'summary',
      '--since',
      '2024-06-15T00:00:00.000Z',
    ]);
  });

  test('first two args are always analytics and summary', () => {
    const args = buildAnalyticsSummaryArgs({ since: '2024-01-01' });
    expect(args[0]).toBe('analytics');
    expect(args[1]).toBe('summary');
  });
});

// ============================================================================
// gremlin_analytics_performance
// ============================================================================

describe('gremlin_analytics_performance args', () => {
  test('builds minimal args with no options', () => {
    const args = buildAnalyticsPerformanceArgs({});
    expect(args).toEqual(['analytics', 'performance']);
  });

  test('includes --app flag when provided', () => {
    const args = buildAnalyticsPerformanceArgs({ app: 'my-app' });
    expect(args).toContain('--app');
    expect(args).toContain('my-app');
  });

  test('includes --since flag when provided', () => {
    const args = buildAnalyticsPerformanceArgs({ since: '2024-03-01' });
    expect(args).toContain('--since');
    expect(args).toContain('2024-03-01');
  });

  test('includes both --app and --since when provided', () => {
    const args = buildAnalyticsPerformanceArgs({
      app: 'web-app',
      since: '2024-06-01',
    });

    expect(args).toContain('--app');
    expect(args).toContain('web-app');
    expect(args).toContain('--since');
    expect(args).toContain('2024-06-01');
  });

  test('does not include --app when undefined', () => {
    const args = buildAnalyticsPerformanceArgs({ app: undefined });
    expect(args).not.toContain('--app');
  });

  test('does not include --app when empty string', () => {
    const args = buildAnalyticsPerformanceArgs({ app: '' });
    expect(args).not.toContain('--app');
  });

  test('first two args are always analytics and performance', () => {
    const args = buildAnalyticsPerformanceArgs({
      app: 'test',
      since: '2024-01-01',
    });
    expect(args[0]).toBe('analytics');
    expect(args[1]).toBe('performance');
  });

  test('--app comes before --since in argument order', () => {
    const args = buildAnalyticsPerformanceArgs({
      app: 'my-app',
      since: '2024-01-01',
    });

    const appIdx = args.indexOf('--app');
    const sinceIdx = args.indexOf('--since');
    expect(appIdx).toBeLessThan(sinceIdx);
  });
});

// ============================================================================
// Analytics response handling
// ============================================================================

describe('analytics response handling', () => {
  test('wraps summary data as textResult', () => {
    const summaryData = {
      totalSessions: 42,
      totalEvents: 1500,
      uniqueApps: ['web-app', 'mobile-app'],
      averageEventsPerSession: 35.7,
      dateRange: {
        from: '2024-01-01',
        to: '2024-12-31',
      },
    };

    const result = textResult(summaryData);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalSessions).toBe(42);
    expect(parsed.uniqueApps).toContain('web-app');
  });

  test('wraps performance data as textResult', () => {
    const perfData = {
      lcp: { p50: 1200, p75: 2000, p95: 3500 },
      cls: { p50: 0.05, p75: 0.12, p95: 0.3 },
      inp: { p50: 80, p75: 150, p95: 280 },
      fps: { avg: 58, min: 30, max: 60 },
    };

    const result = textResult(perfData);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.lcp.p50).toBe(1200);
    expect(parsed.cls.p50).toBe(0.05);
    expect(parsed.fps.avg).toBe(58);
  });

  test('handles empty analytics result', () => {
    const emptyData = {
      totalSessions: 0,
      totalEvents: 0,
      uniqueApps: [],
    };

    const result = textResult(emptyData);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalSessions).toBe(0);
    expect(parsed.uniqueApps).toEqual([]);
  });

  test('wraps analytics error as errorResult', () => {
    const result = errorResult('No analytics data found');
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('No analytics data found');
  });
});

// ============================================================================
// parseCliJsonEnvelope for analytics output
// ============================================================================

describe('parseCliJsonEnvelope for analytics', () => {
  test('parses successful analytics summary output', () => {
    const cliResult: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        command: 'analytics',
        data: { totalSessions: 10, totalEvents: 500 },
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(true);
    expect((envelope.data as Record<string, unknown>).totalSessions).toBe(10);
  });

  test('parses successful performance output', () => {
    const cliResult: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        command: 'analytics',
        data: {
          lcp: { p50: 1000 },
          sessionCount: 5,
        },
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as Record<string, unknown>;
    expect((data.lcp as Record<string, number>).p50).toBe(1000);
  });

  test('handles error when no sessions exist', () => {
    const cliResult: CliResult = {
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        command: 'analytics',
        data: null,
        errors: ['No sessions found. Run gremlin dev to start recording.'],
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toBeDefined();
    expect(envelope.errors![0]).toContain('No sessions found');
  });
});

// ============================================================================
// Tool handler pattern for analytics
// ============================================================================

describe('createToolHandler pattern for analytics', () => {
  test('summary handler builds correct args with since param', () => {
    const params = { since: '2024-06-01' };
    const args = buildAnalyticsSummaryArgs(params);
    expect(args).toEqual(['analytics', 'summary', '--since', '2024-06-01']);
  });

  test('performance handler builds correct args with app and since params', () => {
    const params = { app: 'web-app', since: '2024-01-01' };
    const args = buildAnalyticsPerformanceArgs(params);
    expect(args).toEqual([
      'analytics',
      'performance',
      '--app',
      'web-app',
      '--since',
      '2024-01-01',
    ]);
  });

  test('handler returns textResult on success', () => {
    const envelope: CliEnvelope = {
      ok: true,
      command: 'analytics',
      data: { totalSessions: 15 },
    };

    const response = envelope.ok
      ? textResult(envelope.data)
      : errorResult(envelope.errors?.[0] ?? 'Command failed');

    expect(response).not.toHaveProperty('isError');
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.totalSessions).toBe(15);
  });

  test('handler returns errorResult on failure', () => {
    const envelope: CliEnvelope = {
      ok: false,
      data: null,
      errors: ['Analytics computation failed'],
    };

    const response = envelope.ok
      ? textResult(envelope.data)
      : errorResult(envelope.errors?.[0] ?? 'Command failed');

    expect(response).toHaveProperty('isError', true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe('Analytics computation failed');
  });

  test('handler falls back to generic error message', () => {
    const envelope: CliEnvelope = {
      ok: false,
      data: null,
    };

    const response = envelope.ok
      ? textResult(envelope.data)
      : errorResult(envelope.errors?.[0] ?? 'Command failed');

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe('Command failed');
  });
});
