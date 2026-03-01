/**
 * R2 storage layer for Gremlin sessions
 */

import type { GremlinSession } from '@gremlin/session';
import { generateSessionId } from '@gremlin/session';
import type { Env, SessionListResult, SessionSummary } from './types.ts';
import { createSessionSummary } from './types.ts';
import type {
  PerfQueryOptions,
  PerformanceAggregation,
  PerformanceTimeline,
  PerformanceTimelineEntry,
} from '@gremlin/server-shared';
import { filterSortPaginate, computePerformanceAggregation, toSessionSummary } from '@gremlin/server-shared';

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
  const metadata: Record<string, string> = {
    sessionId,
    startTime: session.header.startTime.toString(),
    endTime: session.header.endTime != null ? session.header.endTime.toString() : '',
    platform: session.header.device.platform,
    appName: session.header.app.name,
    appVersion: session.header.app.version,
    eventCount: session.events.length.toString(),
    screenshotCount: session.screenshots.length.toString(),
    uploadedAt: Date.now().toString(),
    schemaVersion: session.header.schemaVersion.toString(),
  };

  // Store compact performance summary in metadata for efficient listing
  if (session.performance) {
    metadata.performance = JSON.stringify(session.performance);
  }

  // Store in R2 with the session ID as the key
  await env.SESSIONS.put(`sessions/${sessionId}.json`, sessionBytes, {
    customMetadata: metadata,
    httpMetadata: {
      contentType: 'application/json',
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

      sessions.push(toSessionSummary({ id, ...metadata, size: object.size }));
    }

    // R2 returns keys in lexicographic order; sort by upload time within this page
    // Note: cross-page ordering relies on R2 cursor-based pagination
    sessions.sort((a, b) => b.uploadedAt - a.uploadedAt);

    return {
      sessions,
      cursor: listed.truncated ? listed.cursor : undefined,
      hasMore: listed.truncated,
      // totalCount omitted: R2 paginated list doesn't provide total count
    };
  } catch (error) {
    console.error('Error listing sessions:', error);
    throw error;
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

    return toSessionSummary({ id, ...metadata, size: object.size });
  } catch (error) {
    console.error('Error getting session metadata:', error);
    return null;
  }
}

/**
 * Append events to an existing session in R2
 * @returns true if the session was found and events appended, false if not found
 */
export async function appendSessionEvents(
  env: Env,
  id: string,
  events: unknown[]
): Promise<boolean> {
  try {
    const object = await env.SESSIONS.get(`sessions/${id}.json`);

    if (!object) {
      return false;
    }

    const text = await object.text();
    const session = JSON.parse(text) as GremlinSession;

    session.events = [...(session.events || []), ...(events as GremlinSession['events'])];

    const sessionJson = JSON.stringify(session);
    const sessionBytes = new TextEncoder().encode(sessionJson);

    // Preserve existing metadata and update eventCount
    const existingMetadata = object.customMetadata ?? {};
    const updatedMetadata: Record<string, string> = {
      ...existingMetadata,
      eventCount: session.events.length.toString(),
    };

    await env.SESSIONS.put(`sessions/${id}.json`, sessionBytes, {
      customMetadata: updatedMetadata,
      httpMetadata: {
        contentType: 'application/json',
      },
    });

    return true;
  } catch (error) {
    console.error('Error appending session events:', error);
    return false;
  }
}

async function loadAllSessionSummaries(env: Env): Promise<SessionSummary[]> {
  const summaries: SessionSummary[] = [];
  let cursor: string | undefined;

  do {
    const listed = await env.SESSIONS.list({
      prefix: 'sessions/',
      limit: 1000,
      cursor,
    });

    for (const obj of listed.objects) {
      const metadata = obj.customMetadata;
      if (!metadata) continue;

      const id = obj.key.replace('sessions/', '').replace('.json', '');
      summaries.push(toSessionSummary({ id, ...metadata, size: obj.size }));
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return summaries;
}

export async function listSessionsWithPerf(
  env: Env,
  opts: PerfQueryOptions
): Promise<SessionListResult> {
  const summaries = await loadAllSessionSummaries(env);
  return filterSortPaginate(summaries, opts);
}

export async function getPerformanceAggregation(
  env: Env
): Promise<PerformanceAggregation> {
  const summaries = await loadAllSessionSummaries(env);
  return computePerformanceAggregation(summaries);
}

// ============================================================================
// Per-session performance timeline
// ============================================================================

export async function getSessionPerformance(
  env: Env,
  id: string
): Promise<PerformanceTimeline | null> {
  const object = await env.SESSIONS.get(`sessions/${id}.json`);
  if (!object) return null;

  let session: GremlinSession;
  try {
    session = JSON.parse(await object.text()) as GremlinSession;
  } catch {
    return null;
  }
  const size = object.size;
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
