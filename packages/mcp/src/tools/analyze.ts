import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerAnalyzeTools(server: McpServer): void {
  server.tool(
    'gremlin_analyze',
    'AI-powered insights from recorded sessions — UX issues, errors, patterns, recommendations',
    {
      provider: z.string().optional().describe('AI provider: anthropic, openai, gemini'),
      focus: z.string().optional().describe('Focus area: ux, errors, performance, all (default: all)'),
    },
    createToolHandler(({ provider, focus }) => {
      const args = ['analyze'];
      if (provider) args.push('--provider', String(provider));
      if (focus) args.push('--focus', String(focus));
      return args;
    })
  );
}
