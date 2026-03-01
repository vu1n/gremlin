import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandler } from './helpers.ts';

export function registerInitTools(server: McpServer): void {
  server.tool(
    'gremlin_init',
    'Initialize Gremlin in the current project',
    {
      appName: z.string().optional().describe('App name for recorder config'),
      framework: z.string().optional().describe('Force framework: nextjs, vite, cra, remix, expo, react-native'),
      skipInstall: z.boolean().optional().describe('Skip SDK package installation'),
      serverUrl: z.string().optional().describe('Remote server URL for config'),
      force: z.boolean().optional().describe('Reinitialize even if already configured'),
    },
    createToolHandler(({ appName, framework, skipInstall, serverUrl, force }) => {
      const args = ['init'];
      if (appName) args.push('--app-name', String(appName));
      if (framework) args.push('--framework', String(framework));
      if (skipInstall) args.push('--skip-install');
      if (serverUrl) args.push('--server-url', String(serverUrl));
      if (force) args.push('--force');
      return args;
    })
  );
}
