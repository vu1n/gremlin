/**
 * Filesystem storage layer for Gremlin sessions
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';
import type {
  ServerConfig,
  SessionIndexEntry,
  SessionListResult,
  SessionSummary,
} from './types';
import { createSessionSummary } from './types';

const INDEX_FILE = 'index.json';

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
  const sessionJson = JSON.stringify(session, null, 2);
  const sessionSize = new TextEncoder().encode(sessionJson).length;
  const uploadedAt = Date.now();

  writeFileSync(sessionPath, sessionJson);

  const summary = createSessionSummary(sessionId, session, sessionSize, uploadedAt);
  const indexEntry: SessionIndexEntry = {
    ...summary,
    storedAt: uploadedAt,
    path: sessionPath,
  };

  const index = loadIndex(config);
  index[sessionId] = indexEntry;
  saveIndex(config, index);

  return sessionId;
}

export async function getSession(
  config: ServerConfig,
  id: string
): Promise<GremlinSession | null> {
  const sessionPath = join(config.dataDir, 'sessions', `${id}.json`);

  if (!existsSync(sessionPath)) {
    return null;
  }

  const content = readFileSync(sessionPath, 'utf-8');
  return JSON.parse(content) as GremlinSession;
}

export async function listSessions(
  config: ServerConfig,
  limit: number = 20,
  cursor?: string
): Promise<SessionListResult> {
  const index = loadIndex(config);
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
  }));

  const nextCursor =
    startIndex + limit < entries.length ? page[page.length - 1]?.id : undefined;

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

  if (!existsSync(sessionPath)) {
    return false;
  }

  rmSync(sessionPath, { force: true });

  const index = loadIndex(config);
  if (index[id]) {
    delete index[id];
    saveIndex(config, index);
  }

  return true;
}

export async function getSessionMetadata(
  config: ServerConfig,
  id: string
): Promise<SessionSummary | null> {
  const index = loadIndex(config);
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
  };
}

function loadIndex(config: ServerConfig): Record<string, SessionIndexEntry> {
  const indexPath = join(config.dataDir, INDEX_FILE);

  if (!existsSync(indexPath)) {
    return {};
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content) as Record<string, SessionIndexEntry>;
  } catch (error) {
    console.error('Failed to read session index:', error);
    return {};
  }
}

function saveIndex(
  config: ServerConfig,
  index: Record<string, SessionIndexEntry>
): void {
  const indexPath = join(config.dataDir, INDEX_FILE);
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}
