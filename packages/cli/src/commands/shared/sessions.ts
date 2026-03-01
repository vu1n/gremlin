/**
 * Session Loading Helpers
 *
 * Shared utilities for loading session files and ensuring directories exist.
 */

import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';

/**
 * Ensure a directory exists, creating it (and parents) if needed.
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load all GremlinSession JSON files from a directory.
 *
 * Optionally filters sessions by a `since` date (ISO string).
 * Always warns on file parse failures rather than silently swallowing errors.
 */
export async function loadSessions(
  dir: string,
  options?: { since?: string }
): Promise<GremlinSession[]> {
  const sessions: GremlinSession[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const sinceTime = options?.since ? new Date(options.since).getTime() : 0;

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = await Bun.file(filePath).text();
      const session = JSON.parse(content) as GremlinSession;

      if (sinceTime && (session.header?.startTime ?? 0) < sinceTime) {
        continue;
      }

      sessions.push(session);
    } catch {
      console.warn(`   Warning: Could not load ${file}`);
    }
  }

  return sessions;
}
