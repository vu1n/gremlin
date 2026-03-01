import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getProjectRoot } from './helpers.ts';

function gremlinPath(...segments: string[]): string {
  return join(getProjectRoot(), '.gremlin', ...segments);
}

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

export function registerResources(server: McpServer): void {
  server.resource(
    'config',
    'gremlin://config',
    { description: 'Gremlin project configuration' },
    async (uri) => {
      const configPath = gremlinPath('config.json');
      const result = readJsonFile<unknown>(configPath);

      if (!result.ok) {
        const errorMsg = result.reason === 'not_found'
          ? 'No config found. Run gremlin init first.'
          : result.reason === 'invalid_json'
            ? 'Config file contains invalid JSON.'
            : 'Error reading config file.';
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json' as const,
            text: JSON.stringify({ error: errorMsg }),
          }],
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(result.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'sessions/{id}',
    'gremlin://sessions/{id}',
    { description: 'Read a session by ID' },
    async (uri) => {
      const id = uri.pathname.split('/').filter(Boolean).pop() ?? '';
      const sessionPath = gremlinPath('sessions', `${id}.json`);
      const result = readJsonFile<unknown>(sessionPath);

      if (!result.ok) {
        const errorMsg = result.reason === 'not_found'
          ? `Session not found: ${id}`
          : result.reason === 'invalid_json'
            ? `Session file contains invalid JSON: ${id}`
            : `Error reading session file: ${id}`;
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json' as const,
            text: JSON.stringify({ error: errorMsg }),
          }],
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(result.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'spec',
    'gremlin://spec',
    { description: 'GremlinSpec test specification' },
    async (uri) => {
      const specPath = gremlinPath('tests', 'spec.json');
      const result = readJsonFile<unknown>(specPath);

      if (!result.ok) {
        const errorMsg = result.reason === 'not_found'
          ? 'No spec found. Run gremlin generate first.'
          : result.reason === 'invalid_json'
            ? 'Spec file contains invalid JSON.'
            : 'Error reading spec file.';
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json' as const,
            text: JSON.stringify({ error: errorMsg }),
          }],
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(result.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'llms.txt',
    'gremlin://llms.txt',
    { description: 'LLM-friendly instrumentation context' },
    async (uri) => {
      const llmsPath = gremlinPath('llms.txt');

      let text: string;
      try {
        text = existsSync(llmsPath) ? readFileSync(llmsPath, 'utf-8') : 'No llms.txt found. Run gremlin instrument --llms to generate.';
      } catch {
        text = 'Error reading llms.txt';
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/plain' as const,
          text,
        }],
      };
    }
  );
}
