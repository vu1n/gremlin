/**
 * R2 storage layer for Gremlin sessions
 */

import type { GremlinSession, PerformanceSample } from '@gremlin/session';
import type { Env, SessionListResult, SessionSummary } from './types';
import { createSessionSummary } from './types';
import type {
  PerfSortKey,
  PerfQueryOptions,
  PerformanceAggregation,
  PerformanceTimeline,
  PerformanceTimelineEntry,
} from '@gremlin/server-shared';

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().split('-')[0];
  return `${timestamp}-${random}`;
}

/**
 * Store a session in R2
 * @returns The session ID
 */
export async function storeSession(
  env: Env,
  session: GremlinSession
): Promise<string> {
  // Use the session ID from the header, or generate a new one
  const sessionId = session.header.sessionId || generateSessionId();

  // Serialize the session
  const sessionJson = JSON.stringify(session);
  const sessionBytes = new TextEncoder().encode(sessionJson);

  // Create metadata for efficient querying
  const metadata = {
    sessionId,
    startTime: session.header.startTime.toString(),
    endTime: session.header.endTime?.toString() || '',
    platform: session.header.device.platform,
    appName: session.header.app.name,
    appVersion: session.header.app.version,
    eventCount: session.events.length.toString(),
    screenshotCount: session.screenshots.length.toString(),
    uploadedAt: Date.now().toString(),
    schemaVersion: session.header.schemaVersion.toString(),
  };

  // Store in R2 with the session ID as the key
  await env.SESSIONS.put(`sessions/${sessionId}.json`, sessionBytes, {
    customMetadata: metadata,
    httpMetadata: {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    },
  });

  return sessionId;
}

/**
 * Retrieve a session from R2
 * @returns The session or null if not found
 */
export async function getSession(
  env: Env,
  id: string
): Promise<GremlinSession | null> {
  try {
    const object = await env.SESSIONS.get(`sessions/${id}.json`);

    if (!object) {
      return null;
    }

    const text = await object.text();
    const session = JSON.parse(text) as GremlinSession;

    return session;
  } catch (error) {
    console.error('Error retrieving session:', error);
    return null;
  }
}

/**
 * List sessions with pagination
 * @param limit Maximum number of sessions to return
 * @param cursor Pagination cursor for next page
 * @returns List of session summaries with pagination info
 */
export async function listSessions(
  env: Env,
  limit: number = 20,
  cursor?: string
): Promise<SessionListResult> {
  try {
    // List objects in R2 with pagination
    const listed = await env.SESSIONS.list({
      prefix: 'sessions/',
      limit,
      cursor,
    });

    // Convert R2 objects to session summaries
    const sessions: SessionSummary[] = [];

    for (const object of listed.objects) {
      const metadata = object.customMetadata;

      if (!metadata) {
        continue;
      }

      // Extract session ID from key (sessions/{id}.json)
      const id = object.key.replace('sessions/', '').replace('.json', '');

      const summary: SessionSummary = {
        id,
        startTime: parseInt(metadata.startTime || '0', 10),
        endTime: metadata.endTime ? parseInt(metadata.endTime, 10) : undefined,
        duration:
          metadata.endTime && metadata.startTime
            ? parseInt(metadata.endTime, 10) - parseInt(metadata.startTime, 10)
            : undefined,
        platform: (metadata.platform || 'web') as 'web' | 'ios' | 'android',
        appName: metadata.appName || 'unknown',
        appVersion: metadata.appVersion || 'unknown',
        eventCount: parseInt(metadata.eventCount || '0', 10),
        screenshotCount: parseInt(metadata.screenshotCount || '0', 10),
        size: object.size,
        uploadedAt: parseInt(metadata.uploadedAt || '0', 10),
      };

      sessions.push(summary);
    }

    // Sort by upload time (most recent first)
    sessions.sort((a, b) => b.uploadedAt - a.uploadedAt);

    return {
      sessions,
      cursor: listed.truncated ? listed.cursor : undefined,
      hasMore: listed.truncated,
    };
  } catch (error) {
    console.error('Error listing sessions:', error);
    return {
      sessions: [],
      hasMore: false,
    };
  }
}

/**
 * Delete a session from R2
 * @returns true if deleted, false if not found
 */
export async function deleteSession(
  env: Env,
  id: string
): Promise<boolean> {
  try {
    // Check if the session exists first
    const exists = await env.SESSIONS.head(`sessions/${id}.json`);

    if (!exists) {
      return false;
    }

    // Delete the session
    await env.SESSIONS.delete(`sessions/${id}.json`);

    return true;
  } catch (error) {
    console.error('Error deleting session:', error);
    return false;
  }
}

/**
 * Get session metadata without downloading the full session
 */
export async function getSessionMetadata(
  env: Env,
  id: string
): Promise<SessionSummary | null> {
  try {
    const object = await env.SESSIONS.head(`sessions/${id}.json`);

    if (!object) {
      return null;
    }

    const metadata = object.customMetadata;

    if (!metadata) {
      return null;
    }

    return {
      id,
      startTime: parseInt(metadata.startTime || '0', 10),
      endTime: metadata.endTime ? parseInt(metadata.endTime, 10) : undefined,
      duration:
        metadata.endTime && metadata.startTime
          ? parseInt(metadata.endTime, 10) - parseInt(metadata.startTime, 10)
          : undefined,
      platform: (metadata.platform || 'web') as 'web' | 'ios' | 'android',
      appName: metadata.appName || 'unknown',
      appVersion: metadata.appVersion || 'unknown',
      eventCount: parseInt(metadata.eventCount || '0', 10),
      screenshotCount: parseInt(metadata.screenshotCount || '0', 10),
      size: object.size,
      uploadedAt: parseInt(metadata.uploadedAt || '0', 10),
    };
  } catch (error) {
    console.error('Error getting session metadata:', error);
    return null;
  }
}

// ============================================================================
// Performance query helpers
// ============================================================================

function getPerfValueFromSummary(s: SessionSummary, key: PerfSortKey): number | undefined {
  const p = s.performance;
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
    case 'duration': return s.duration;
    case 'eventCount': return s.eventCount;
    case 'startTime': return s.startTime;
  }
}

/**
 * Load all sessions from R2 and return summaries with performance data.
 * Note: R2 custom metadata doesn't store perf data, so we must fetch full sessions.
 */
async function loadAllSessionsWithPerf(env: Env): Promise<SessionSummary[]> {
  const summaries: SessionSummary[] = [];
  let cursor: string | undefined;

  // Paginate through all R2 objects
  do {
    const listed = await env.SESSIONS.list({
      prefix: 'sessions/',
      limit: 100,
      cursor,
    });

    for (const obj of listed.objects) {
      const id = obj.key.replace('sessions/', '').replace('.json', '');
      const full = await env.SESSIONS.get(obj.key);
      if (!full) continue;

      const session = JSON.parse(await full.text()) as GremlinSession;
      const uploadedAt = parseInt(obj.customMetadata?.uploadedAt || '0', 10);
      summaries.push(createSessionSummary(id, session, obj.size, uploadedAt));
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return summaries;
}

export async function listSessionsWithPerf(
  env: Env,
  opts: PerfQueryOptions
): Promise<SessionListResult> {
  let summaries = await loadAllSessionsWithPerf(env);

  // Apply filters
  if (opts.filters && opts.filters.length > 0) {
    summaries = summaries.filter((s) =>
      opts.filters!.every((f) => {
        const val = getPerfValueFromSummary(s, f.key);
        if (val === undefined) return false;
        return f.op === 'gt' ? val > f.value : val < f.value;
      })
    );
  }

  // Sort
  const sortKey = opts.sort ?? 'startTime';
  const desc = (opts.order ?? 'desc') === 'desc';

  summaries.sort((a, b) => {
    const va = getPerfValueFromSummary(a, sortKey);
    const vb = getPerfValueFromSummary(b, sortKey);
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return desc ? vb - va : va - vb;
  });

  const limit = opts.limit ?? 20;
  const page = summaries.slice(0, limit);

  return {
    sessions: page,
    hasMore: summaries.length > limit,
    totalCount: summaries.length,
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
  env: Env
): Promise<PerformanceAggregation> {
  const summaries = await loadAllSessionsWithPerf(env);

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

  for (const s of summaries) {
    const p = s.performance;
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
    sessionCount: summaries.length,
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
  env: Env,
  id: string
): Promise<PerformanceTimeline | null> {
  const session = await getSession(env, id);
  if (!session) return null;

  const size = new TextEncoder().encode(JSON.stringify(session)).length;
  const metadata = await getSessionMetadata(env, id);
  const uploadedAt = metadata?.uploadedAt ?? 0;
  const summary = createSessionSummary(id, session, size, uploadedAt);

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
