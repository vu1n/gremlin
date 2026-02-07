/**
 * Sessions command - list recorded sessions
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession, SessionPerformance } from '@gremlin/session';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface SessionsOptions extends OutputOptions {
  /** Input directory for sessions */
  input?: string;

  /** Max sessions to list */
  limit?: number;

  /** Sort by metric */
  sort?: string;

  /** Filter: LCP greater than (ms) */
  lcpGt?: number;

  /** Filter: CLS greater than */
  clsGt?: number;

  /** Filter: avgFps less than */
  fpsLt?: number;

  /** Shorthand for failing Core Web Vitals */
  slow?: boolean;
}

export interface SessionSummary {
  id: string;
  appName: string;
  platform: string;
  eventCount: number;
  startTime: number;
  performance?: SessionPerformance;
}

export interface SessionsResult {
  sessions: SessionSummary[];
  total: number;
  directory: string;
}

// ============================================================================
// Core Web Vitals thresholds (Google "Poor" boundary)
// ============================================================================

const CWV_THRESHOLDS = {
  lcp: 2500,
  cls: 0.25,
  inp: 200,
};

// ============================================================================
// Helpers
// ============================================================================

function getPerfSortValue(s: SessionSummary, metric: string): number {
  const p = s.performance;
  if (!p) return Infinity;

  switch (metric) {
    case 'lcp': return p.webVitals?.lcp ?? Infinity;
    case 'cls': return p.webVitals?.cls ?? Infinity;
    case 'inp': return p.webVitals?.inp ?? Infinity;
    case 'fcp': return p.webVitals?.fcp ?? Infinity;
    case 'ttfb': return p.webVitals?.ttfb ?? Infinity;
    case 'fps': return -(p.avgFps ?? 0); // Lower FPS = worse = sort first
    case 'longTasks': return -(p.longTaskCount ?? 0);
    case 'memory': return -(p.peakMemoryUsage ?? 0);
    case 'duration': return -(p.webVitals?.lcp ?? p.pageLoadTime ?? 0);
    default: return 0;
  }
}

function isSlowSession(s: SessionSummary): boolean {
  const wv = s.performance?.webVitals;
  if (!wv) return false;
  return (
    (wv.lcp !== undefined && wv.lcp > CWV_THRESHOLDS.lcp) ||
    (wv.cls !== undefined && wv.cls > CWV_THRESHOLDS.cls) ||
    (wv.inp !== undefined && wv.inp > CWV_THRESHOLDS.inp)
  );
}

function formatPerfLine(p: SessionPerformance | undefined): string {
  if (!p) return 'no perf data';
  const parts: string[] = [];
  if (p.webVitals?.lcp !== undefined) parts.push(`LCP:${p.webVitals.lcp.toFixed(0)}ms`);
  if (p.webVitals?.cls !== undefined) parts.push(`CLS:${p.webVitals.cls.toFixed(3)}`);
  if (p.webVitals?.inp !== undefined) parts.push(`INP:${p.webVitals.inp.toFixed(0)}ms`);
  if (p.avgFps !== undefined) parts.push(`FPS:${p.avgFps.toFixed(0)}`);
  return parts.length > 0 ? parts.join(' | ') : 'no perf data';
}

// ============================================================================
// Command
// ============================================================================

export async function listSessions(options: SessionsOptions): Promise<SessionsResult> {
  const input = options.input ?? '.gremlin/sessions';
  const limit = options.limit ?? 20;

  if (!existsSync(input)) {
    const result: SessionsResult = { sessions: [], total: 0, directory: input };
    if (output('sessions', result, options)) return result;
    console.log(`No sessions found. Directory does not exist: ${input}`);
    return result;
  }

  const files = readdirSync(input).filter((file) => file.endsWith('.json'));

  if (files.length === 0) {
    const result: SessionsResult = { sessions: [], total: 0, directory: input };
    if (output('sessions', result, options)) return result;
    console.log(`No sessions found in ${input}`);
    return result;
  }

  const summaries: SessionSummary[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(input, file), 'utf-8');
      const session = JSON.parse(content) as GremlinSession;
      summaries.push({
        id: session.header?.sessionId || file.replace('.json', ''),
        appName: session.header?.app?.name || 'unknown',
        platform: session.header?.device?.platform || 'unknown',
        eventCount: session.events?.length || 0,
        startTime: session.header?.startTime || 0,
        performance: session.performance,
      });
    } catch {
      // Skip unreadable session files
    }
  }

  // Apply perf filters
  let filtered = summaries;

  if (options.slow) {
    filtered = filtered.filter(isSlowSession);
  }
  if (options.lcpGt !== undefined) {
    filtered = filtered.filter((s) => (s.performance?.webVitals?.lcp ?? 0) > options.lcpGt!);
  }
  if (options.clsGt !== undefined) {
    filtered = filtered.filter((s) => (s.performance?.webVitals?.cls ?? 0) > options.clsGt!);
  }
  if (options.fpsLt !== undefined) {
    filtered = filtered.filter((s) => (s.performance?.avgFps ?? Infinity) < options.fpsLt!);
  }

  // Sort
  const sortMetric = options.sort ?? 'time';
  if (sortMetric === 'time') {
    filtered.sort((a, b) => b.startTime - a.startTime);
  } else {
    filtered.sort((a, b) => {
      const va = getPerfSortValue(a, sortMetric);
      const vb = getPerfSortValue(b, sortMetric);
      return vb - va; // Worst first (highest value = worst)
    });
  }

  const result: SessionsResult = {
    sessions: filtered.slice(0, limit),
    total: filtered.length,
    directory: input,
  };

  if (output('sessions', result, options)) return result;

  console.log(`Found ${filtered.length} sessions in ${input}`);

  for (const summary of filtered.slice(0, limit)) {
    const timestamp = summary.startTime
      ? new Date(summary.startTime).toISOString()
      : 'unknown-time';
    const perf = formatPerfLine(summary.performance);
    console.log(
      `- ${summary.id} | ${summary.appName} | ${summary.platform} | ${summary.eventCount} events | ${timestamp} | ${perf}`
    );
  }

  return result;
}
