/**
 * Filesystem storage layer for Gremlin sessions
 */

import { rename, rm } from 'fs/promises';
import { join } from 'path';
import type { GremlinSession, PerformanceSample } from '@gremlin/session';
import type {
  ServerConfig,
  SessionIndexEntry,
  SessionListResult,
  SessionSummary,
} from './types';
import { createSessionSummary } from './types';
import type {
  PerfSortKey,
  PerfQueryOptions,
  PerformanceAggregation,
  PerformanceTimeline,
  PerformanceTimelineEntry,
} from '@gremlin/server-shared';

const INDEX_FILE = 'index.json';

// Serialize index read-modify-write operations to prevent concurrent corruption
let indexLock: Promise<unknown> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = indexLock.catch(() => {}).then(fn);
  indexLock = result.catch(() => {});
  return result;
}

export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().split('-')[0];
  return `${timestamp}-${random}`;
}

export async function storeSession(
  config: ServerConfig,
  session: GremlinSession
): Promise<string> {
  const sessionId = session.header.sessionId || generateSessionId();
  const sessionsDir = join(config.dataDir, 'sessions');
  const sessionPath = join(sessionsDir, `${sessionId}.json`);
  const tempSessionPath = join(sessionsDir, `${sessionId}.json.tmp`);
  const sessionJson = JSON.stringify(session, null, 2);
  const sessionSize = new TextEncoder().encode(sessionJson).length;
  const uploadedAt = Date.now();

  await Bun.write(tempSessionPath, sessionJson);
  await rename(tempSessionPath, sessionPath);

  const summary = createSessionSummary(sessionId, session, sessionSize, uploadedAt);
  const indexEntry: SessionIndexEntry = {
    ...summary,
    storedAt: uploadedAt,
    path: sessionPath,
  };

  await withIndexLock(async () => {
    const index = await loadIndex(config);
    index[sessionId] = indexEntry;
    await saveIndex(config, index);
  });

  return sessionId;
}

export async function getSession(
  config: ServerConfig,
  id: string
): Promise<GremlinSession | null> {
  const sessionPath = join(config.dataDir, 'sessions', `${id}.json`);
  const file = Bun.file(sessionPath);

  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  return JSON.parse(content) as GremlinSession;
}

export async function listSessions(
  config: ServerConfig,
  limit: number = 20,
  cursor?: string
): Promise<SessionListResult> {
  const index = await loadIndex(config);
  const entries = Object.values(index).sort(
    (a, b) => b.uploadedAt - a.uploadedAt
  );

  let startIndex = 0;
  if (cursor) {
    const cursorIndex = entries.findIndex((entry) => entry.id === cursor);
    if (cursorIndex >= 0) {
      startIndex = cursorIndex + 1;
    }
  }

  const page = entries.slice(startIndex, startIndex + limit);
  const sessions: SessionSummary[] = page.map((entry) => ({
    id: entry.id,
    startTime: entry.startTime,
    endTime: entry.endTime,
    duration: entry.duration,
    platform: entry.platform,
    appName: entry.appName,
    appVersion: entry.appVersion,
    eventCount: entry.eventCount,
    screenshotCount: entry.screenshotCount,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
    performance: entry.performance,
  }));

  const nextCursor =
    startIndex + limit < entries.length && page.length > 0 ? page[page.length - 1].id : undefined;

  return {
    sessions,
    cursor: nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: entries.length,
  };
}

export async function deleteSession(
  config: ServerConfig,
  id: string
): Promise<boolean> {
  const sessionPath = join(config.dataDir, 'sessions', `${id}.json`);
  const file = Bun.file(sessionPath);

  if (!(await file.exists())) {
    return false;
  }

  // Update index first, then delete file — if delete fails, stale index entry
  // is less harmful than an orphaned index entry pointing to a missing file
  await withIndexLock(async () => {
    const index = await loadIndex(config);
    if (index[id]) {
      delete index[id];
      await saveIndex(config, index);
    }
  });

  await rm(sessionPath, { force: true });

  return true;
}

export async function getSessionMetadata(
  config: ServerConfig,
  id: string
): Promise<SessionSummary | null> {
  const index = await loadIndex(config);
  const entry = index[id];

  if (!entry) {
    return null;
  }

  return {
    id: entry.id,
    startTime: entry.startTime,
    endTime: entry.endTime,
    duration: entry.duration,
    platform: entry.platform,
    appName: entry.appName,
    appVersion: entry.appVersion,
    eventCount: entry.eventCount,
    screenshotCount: entry.screenshotCount,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
    performance: entry.performance,
  };
}

async function loadIndex(config: ServerConfig): Promise<Record<string, SessionIndexEntry>> {
  const indexPath = join(config.dataDir, INDEX_FILE);
  const file = Bun.file(indexPath);

  if (!(await file.exists())) {
    return {};
  }

  try {
    const content = await file.text();
    return JSON.parse(content) as Record<string, SessionIndexEntry>;
  } catch (error) {
    console.error('Failed to read session index:', error);
    return {};
  }
}

async function saveIndex(
  config: ServerConfig,
  index: Record<string, SessionIndexEntry>
): Promise<void> {
  const indexPath = join(config.dataDir, INDEX_FILE);
  const tempIndexPath = join(config.dataDir, `${INDEX_FILE}.tmp`);
  await Bun.write(tempIndexPath, JSON.stringify(index, null, 2));
  await rename(tempIndexPath, indexPath);
}

// ============================================================================
// Performance query helpers
// ============================================================================

function getPerfValue(entry: SessionIndexEntry, key: PerfSortKey): number | undefined {
  const p = entry.performance;
  switch (key) {
    case 'lcp': return p?.webVitals?.lcp;
    case 'cls': return p?.webVitals?.cls;
    case 'inp': return p?.webVitals?.inp;
    case 'fcp': return p?.webVitals?.fcp;
    case 'ttfb': return p?.webVitals?.ttfb;
    case 'avgFps': return p?.avgFps;
    case 'minFps': return p?.minFps;
    case 'longTasks': return p?.longTaskCount;
    case 'peakMemory': return p?.peakMemoryUsage;
    case 'pageLoad': return p?.pageLoadTime;
    case 'duration': return entry.duration;
    case 'eventCount': return entry.eventCount;
    case 'startTime': return entry.startTime;
  }
}

function entryToSummary(entry: SessionIndexEntry): SessionSummary {
  return {
    id: entry.id,
    startTime: entry.startTime,
    endTime: entry.endTime,
    duration: entry.duration,
    platform: entry.platform,
    appName: entry.appName,
    appVersion: entry.appVersion,
    eventCount: entry.eventCount,
    screenshotCount: entry.screenshotCount,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
    performance: entry.performance,
  };
}

export async function listSessionsWithPerf(
  config: ServerConfig,
  opts: PerfQueryOptions
): Promise<SessionListResult> {
  const index = await loadIndex(config);
  let entries = Object.values(index);

  // Apply filters
  if (opts.filters && opts.filters.length > 0) {
    entries = entries.filter((entry) =>
      opts.filters!.every((f) => {
        const val = getPerfValue(entry, f.key);
        if (val === undefined) return false;
        return f.op === 'gt' ? val > f.value : val < f.value;
      })
    );
  }

  // Sort
  const sortKey = opts.sort ?? 'startTime';
  const desc = (opts.order ?? 'desc') === 'desc';

  entries.sort((a, b) => {
    const va = getPerfValue(a, sortKey);
    const vb = getPerfValue(b, sortKey);
    // Push entries without the sort value to the end
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return desc ? vb - va : va - vb;
  });

  // Pagination
  const limit = opts.limit ?? 20;
  let startIndex = 0;
  if (opts.cursor) {
    const cursorIndex = entries.findIndex((e) => e.id === opts.cursor);
    if (cursorIndex >= 0) startIndex = cursorIndex + 1;
  }

  const page = entries.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < entries.length && page.length > 0 ? page[page.length - 1].id : undefined;

  return {
    sessions: page.map(entryToSummary),
    cursor: nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: entries.length,
  };
}

// ============================================================================
// Analytics / aggregation
// ============================================================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function aggregateMetric(values: number[]): { median: number; p75: number; p95: number; count: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    count: sorted.length,
  };
}

export async function getPerformanceAggregation(
  config: ServerConfig
): Promise<PerformanceAggregation> {
  const index = await loadIndex(config);
  const entries = Object.values(index);

  const lcpVals: number[] = [];
  const clsVals: number[] = [];
  const inpVals: number[] = [];
  const fcpVals: number[] = [];
  const ttfbVals: number[] = [];
  const avgFpsVals: number[] = [];
  const minFpsVals: number[] = [];
  let longTaskTotal = 0;
  let longTaskDuration = 0;
  let longTaskSessions = 0;
  const peakMemVals: number[] = [];
  const pageLoadVals: number[] = [];
  let sessionsWithPerf = 0;

  for (const entry of entries) {
    const p = entry.performance;
    if (!p) continue;
    sessionsWithPerf++;

    if (p.webVitals?.lcp !== undefined) lcpVals.push(p.webVitals.lcp);
    if (p.webVitals?.cls !== undefined) clsVals.push(p.webVitals.cls);
    if (p.webVitals?.inp !== undefined) inpVals.push(p.webVitals.inp);
    if (p.webVitals?.fcp !== undefined) fcpVals.push(p.webVitals.fcp);
    if (p.webVitals?.ttfb !== undefined) ttfbVals.push(p.webVitals.ttfb);
    if (p.avgFps !== undefined) avgFpsVals.push(p.avgFps);
    if (p.minFps !== undefined) minFpsVals.push(p.minFps);
    if (p.longTaskCount !== undefined) {
      longTaskTotal += p.longTaskCount;
      longTaskDuration += p.longTaskTotalDuration ?? 0;
      longTaskSessions++;
    }
    if (p.peakMemoryUsage !== undefined) peakMemVals.push(p.peakMemoryUsage);
    if (p.pageLoadTime !== undefined) pageLoadVals.push(p.pageLoadTime);
  }

  return {
    sessionCount: entries.length,
    sessionsWithPerf,
    webVitals: {
      lcp: aggregateMetric(lcpVals),
      cls: aggregateMetric(clsVals),
      inp: aggregateMetric(inpVals),
      fcp: aggregateMetric(fcpVals),
      ttfb: aggregateMetric(ttfbVals),
    },
    fps: avgFpsVals.length > 0 ? {
      avgFps: avgFpsVals.reduce((a, b) => a + b, 0) / avgFpsVals.length,
      minFps: Math.min(...minFpsVals.length > 0 ? minFpsVals : avgFpsVals),
      count: avgFpsVals.length,
    } : null,
    longTasks: longTaskSessions > 0 ? {
      totalCount: longTaskTotal,
      totalDuration: longTaskDuration,
      avgPerSession: longTaskTotal / longTaskSessions,
      count: longTaskSessions,
    } : null,
    memory: peakMemVals.length > 0 ? {
      avgPeak: peakMemVals.reduce((a, b) => a + b, 0) / peakMemVals.length,
      maxPeak: Math.max(...peakMemVals),
      count: peakMemVals.length,
    } : null,
    pageLoad: aggregateMetric(pageLoadVals),
  };
}

// ============================================================================
// Per-session performance timeline
// ============================================================================

export async function getSessionPerformance(
  config: ServerConfig,
  id: string
): Promise<PerformanceTimeline | null> {
  const session = await getSession(config, id);
  if (!session) return null;

  const index = await loadIndex(config);
  const entry = index[id];
  const summary: SessionSummary = entry
    ? entryToSummary(entry)
    : createSessionSummary(id, session, 0, 0);

  // Build timeline from event perf samples
  const timeline: PerformanceTimelineEntry[] = [];
  let absoluteTime = session.header.startTime;

  for (const event of session.events) {
    absoluteTime += event.dt;
    if (event.perf) {
      timeline.push({
        timestamp: absoluteTime,
        perf: event.perf,
      });
    }
  }

  return { sessionId: id, summary, timeline };
}
