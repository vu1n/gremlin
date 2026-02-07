/**
 * Sessions command - list recorded sessions
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';

export interface SessionsOptions {
  /** Input directory for sessions */
  input?: string;

  /** Max sessions to list */
  limit?: number;
}

interface SessionSummary {
  id: string;
  appName: string;
  platform: string;
  eventCount: number;
  startTime: number;
}

export async function listSessions(options: SessionsOptions): Promise<void> {
  const input = options.input ?? '.gremlin/sessions';
  const limit = options.limit ?? 20;

  if (!existsSync(input)) {
    console.log(`No sessions found. Directory does not exist: ${input}`);
    return;
  }

  const files = readdirSync(input).filter((file) => file.endsWith('.json'));

  if (files.length === 0) {
    console.log(`No sessions found in ${input}`);
    return;
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
      });
    } catch {
      // Skip unreadable session files
    }
  }

  summaries.sort((a, b) => b.startTime - a.startTime);

  console.log(`Found ${summaries.length} sessions in ${input}`);

  for (const summary of summaries.slice(0, limit)) {
    const timestamp = summary.startTime
      ? new Date(summary.startTime).toISOString()
      : 'unknown-time';
    console.log(
      `- ${summary.id} | ${summary.appName} | ${summary.platform} | ${summary.eventCount} events | ${timestamp}`
    );
  }
}
