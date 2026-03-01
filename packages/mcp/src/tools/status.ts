import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createToolHandler } from './helpers.ts';

export function registerStatusTools(server: McpServer): void {
  server.tool(
    'gremlin_status',
    'Get full project status including config, sessions, tests, and analytics',
    {},
    createToolHandler(() => ['status'])
  );
}
