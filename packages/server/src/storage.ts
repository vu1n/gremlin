/**
 * R2 storage layer for Gremlin sessions
 */

import type { GremlinSession } from '@gremlin/core/session/types';
import type { Env, SessionListResult, SessionSummary } from './types';
import { createSessionSummary } from './types';

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
