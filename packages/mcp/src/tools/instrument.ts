import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerInstrumentTools(server: McpServer): void {
  server.tool(
    'gremlin_instrument_info',
    'Get instrumentation guidance for a framework',
    {
      framework: z.string().optional().describe('Framework: nextjs, vite, cra, remix, expo, react-native'),
    },
    createToolHandler(({ framework }) => {
      const args = ['instrument'];
      if (framework) args.push('--framework', String(framework));
      return args;
    })
  );
}
