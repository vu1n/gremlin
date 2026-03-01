import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerRunTools(server: McpServer): void {
  server.tool(
    'gremlin_run_tests',
    'Run generated tests',
    {
      testsDir: z.string().optional().describe('Tests directory (default .gremlin/tests)'),
    },
    createToolHandler(({ testsDir }) => {
      const args = ['run', '--all'];
      if (testsDir) args.push('--tests-dir', String(testsDir));
      return args;
    })
  );

  server.tool(
    'gremlin_run_perf_tests',
    'Run performance regression tests and compare results against baseline budgets',
    {},
    createToolHandler(() => ['run', '--perf'])
  );
}
