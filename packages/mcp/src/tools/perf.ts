import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerPerfTools(server: McpServer): void {
  server.tool(
    'gremlin_perf_baseline',
    'Snapshot current performance metrics as a baseline for regression testing',
    {
      margin: z.number().optional().describe('Budget margin multiplier above p75 (default 1.4)'),
      update: z.boolean().optional().describe('Update existing baseline (keep tighter budgets)'),
    },
    createToolHandler(({ margin, update }) => {
      const args = ['perf-baseline'];
      if (margin) args.push('--margin', String(margin));
      if (update) args.push('--update');
      return args;
    })
  );
}
