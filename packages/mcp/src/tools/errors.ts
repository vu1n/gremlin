import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerErrorTools(server: McpServer): void {
  server.tool(
    'gremlin_error_patterns',
    'List deduplicated error patterns across sessions with occurrence counts and test coverage status',
    {
      minOccurrences: z.number().optional().describe('Minimum error occurrences to include (default 1)'),
      since: z.string().optional().describe('Filter sessions after this ISO date'),
    },
    createToolHandler(({ minOccurrences, since }) => {
      const args = ['errors'];
      if (minOccurrences) args.push('--min-occurrences', String(minOccurrences));
      if (since) args.push('--since', String(since));
      return args;
    })
  );
}
