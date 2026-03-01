import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';
import { createToolHandler, getProjectRoot, textResult, errorResult } from './helpers.ts';

type JsonFileResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_found' | 'invalid_json' | 'read_error' };

function readJsonFile<T>(path: string): JsonFileResult<T> {
  if (!existsSync(path)) return { ok: false, reason: 'not_found' };
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as T;
    return { ok: true, data };
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, reason: 'invalid_json' };
    return { ok: false, reason: 'read_error' };
  }
}

export function registerSessionTools(server: McpServer): void {
  server.tool(
    'gremlin_sessions_list',
    'List recorded sessions with optional filters',
    {
      limit: z.number().optional().describe('Max sessions to return (default 20)'),
    },
    createToolHandler(({ limit }) => {
      const args = ['sessions'];
      if (limit) args.push('--limit', String(limit));
      return args;
    })
  );

  server.tool(
    'gremlin_session_get',
    'Get full session data by ID',
    {
      sessionId: z.string().describe('Session ID to retrieve'),
    },
    async ({ sessionId }) => {
      const sessionPath = join(getProjectRoot(), '.gremlin', 'sessions', `${sessionId}.json`);
      const result = readJsonFile<GremlinSession>(sessionPath);

      if (!result.ok) {
        const msg = result.reason === 'not_found'
          ? `Session not found: ${sessionId}`
          : result.reason === 'invalid_json'
            ? `Session file contains invalid JSON: ${sessionId}`
            : `Error reading session file: ${sessionId}`;
        return errorResult(msg);
      }

      return textResult(result.data);
    }
  );
}
