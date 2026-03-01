/**
 * Filesystem storage layer for Gremlin sessions
 */

import { rename, rm } from 'fs/promises';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';
import { generateSessionId } from '@gremlin/session';
import type {
  ServerConfig,
  SessionIndexEntry,
  SessionListResult,
  SessionSummary,
} from './types.ts';
import { createSessionSummary } from './types.ts';
import type {
  PerfQueryOptions,
  PerformanceAggregation,
  PerformanceTimeline,
  PerformanceTimelineEntry,
} from '@gremlin/server-shared';
import { filterSortPaginate, computePerformanceAggregation } from '@gremlin/server-shared';

const INDEX_FILE = 'index.json';

// Serialize index read-modify-write operations to prevent concurrent corruption
let indexLock: Promise<unknown> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = indexLock.catch(() => {}).then(fn);
  indexLock = result.catch(() => {});
  return result;
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
  try {
    return JSON.parse(content) as GremlinSession;
  } catch {
    return null;
  }
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

export async function appendSessionEvents(
  config: ServerConfig,
  id: string,
  events: unknown[]
): Promise<boolean> {
  const sessionPath = join(config.dataDir, 'sessions', `${id}.json`);
  const file = Bun.file(sessionPath);

  if (!(await file.exists())) {
    return false;
  }

  return withIndexLock(async () => {
    const content = await file.text();
    let session: GremlinSession;
    try {
      session = JSON.parse(content) as GremlinSession;
    } catch {
      return false;
    }

    session.events = [...(session.events || []), ...(events as GremlinSession['events'])];

    const sessionJson = JSON.stringify(session, null, 2);
    const sessionSize = new TextEncoder().encode(sessionJson).length;
    const tempSessionPath = join(config.dataDir, 'sessions', `${id}.json.tmp`);
    await Bun.write(tempSessionPath, sessionJson);
    await rename(tempSessionPath, sessionPath);

    // Update index with new event count and size
    const index = await loadIndex(config);
    if (index[id]) {
      index[id].eventCount = session.events.length;
      index[id].size = sessionSize;
      await saveIndex(config, index);
    }

    return true;
  });
}

export async function listSessionsWithPerf(
  config: ServerConfig,
  opts: PerfQueryOptions
): Promise<SessionListResult> {
  const index = await loadIndex(config);
  const summaries = Object.values(index).map(entryToSummary);
  return filterSortPaginate(summaries, opts);
}

export async function getPerformanceAggregation(
  config: ServerConfig
): Promise<PerformanceAggregation> {
  const index = await loadIndex(config);
  const summaries = Object.values(index).map(entryToSummary);
  return computePerformanceAggregation(summaries);
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
