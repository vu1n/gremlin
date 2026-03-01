import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerGenerateTools(server: McpServer): void {
  server.tool(
    'gremlin_generate_tests',
    'Generate tests from recorded sessions',
    {
      provider: z.string().optional().describe('AI provider: anthropic, openai, gemini'),
      playwright: z.boolean().optional().describe('Generate Playwright tests'),
      maestro: z.boolean().optional().describe('Generate Maestro tests'),
      input: z.string().optional().describe('Sessions directory path (default .gremlin/sessions)'),
      output: z.string().optional().describe('Output directory for generated tests'),
      spec: z.string().optional().describe('Path to existing spec file'),
      baseUrl: z.string().optional().describe('Base URL for Playwright tests (default http://localhost:3000)'),
      appId: z.string().optional().describe('App ID for Maestro tests'),
    },
    createToolHandler(({ provider, playwright, maestro, input, output, spec, baseUrl, appId }) => {
      const args = ['generate'];
      if (provider) args.push('--provider', String(provider));
      if (playwright) args.push('--playwright');
      if (maestro) args.push('--maestro');
      if (input) args.push('--input', String(input));
      if (output) args.push('--output', String(output));
      if (spec) args.push('--spec', String(spec));
      if (baseUrl) args.push('--base-url', String(baseUrl));
      if (appId) args.push('--app-id', String(appId));
      return args;
    })
  );

  server.tool(
    'gremlin_generate_perf_tests',
    'Generate Playwright performance regression tests from baseline budgets',
    {
      baseUrl: z.string().optional().describe('Base URL for web tests (default http://localhost:3000)'),
    },
    createToolHandler(({ baseUrl }) => {
      const args = ['generate', '--perf'];
      if (baseUrl) args.push('--base-url', String(baseUrl));
      return args;
    })
  );

  server.tool(
    'gremlin_generate_error_tests',
    'Generate Playwright error regression tests from session error patterns',
    {
      minOccurrences: z.number().optional().describe('Minimum error occurrences to generate tests for (default 1)'),
    },
    createToolHandler(({ minOccurrences }) => {
      const args = ['generate', '--errors'];
      if (minOccurrences) args.push('--min-occurrences', String(minOccurrences));
      return args;
    })
  );
}
