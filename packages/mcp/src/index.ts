#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerStatusTools } from './tools/status.ts';
import { registerSessionTools } from './tools/sessions.ts';
import { registerAnalyticsTools } from './tools/analytics.ts';
import { registerGenerateTools } from './tools/generate.ts';
import { registerRunTools } from './tools/run.ts';
import { registerInstrumentTools } from './tools/instrument.ts';
import { registerAnalyzeTools } from './tools/analyze.ts';
import { registerInitTools } from './tools/init.ts';
import { registerPerfTools } from './tools/perf.ts';
import { registerErrorTools } from './tools/errors.ts';
import { registerResources } from './tools/resources.ts';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'gremlin',
    version: '0.0.1',
  });

  registerStatusTools(server);
  registerSessionTools(server);
  registerAnalyticsTools(server);
  registerGenerateTools(server);
  registerRunTools(server);
  registerInstrumentTools(server);
  registerAnalyzeTools(server);
  registerInitTools(server);
  registerPerfTools(server);
  registerErrorTools(server);
  registerResources(server);

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  const server = createServer();
  await startServer(server);
}
