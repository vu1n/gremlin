import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerAnalyticsTools(server: McpServer): void {
  server.tool(
    'gremlin_analytics_summary',
    'Aggregate analytics across sessions',
    {
      since: z.string().optional().describe('Filter after this ISO date'),
    },
    createToolHandler(({ since }) => {
      const args = ['analytics', 'summary'];
      if (since) args.push('--since', String(since));
      return args;
    })
  );

  server.tool(
    'gremlin_analytics_performance',
    'Aggregate performance metrics (Web Vitals, FPS, memory, long tasks) across sessions with p50/p75/p95 percentiles and CWV ratings',
    {
      app: z.string().optional().describe('Filter by app name'),
      since: z.string().optional().describe('Filter after this ISO date'),
    },
    createToolHandler(({ app, since }) => {
      const args = ['analytics', 'performance'];
      if (app) args.push('--app', String(app));
      if (since) args.push('--since', String(since));
      return args;
    })
  );
}
