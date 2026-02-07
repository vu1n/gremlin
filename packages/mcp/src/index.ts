#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { GremlinSession } from '@gremlin/session';

// ============================================================================
// Helpers
// ============================================================================

const cwd = process.cwd();

function gremlinPath(...segments: string[]): string {
  return join(cwd, '.gremlin', ...segments);
}

function readJsonFile<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function countFiles(dir: string, extensions: string[]): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) =>
      extensions.some((ext) => f.endsWith(ext))
    ).length;
  } catch {
    return 0;
  }
}

function textResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

function runCliCommand(args: string): string {
  try {
    const result = execSync(`bun run packages/cli/src/index.ts ${args} --json`, {
      encoding: 'utf-8',
      cwd,
      timeout: 120000,
    });
    return result;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return e.stdout || e.stderr || 'Command failed';
  }
}

// ============================================================================
// Server Setup
// ============================================================================

const server = new McpServer({
  name: 'gremlin',
  version: '0.0.1',
});

// ============================================================================
// Tool: gremlin_status
// ============================================================================

server.tool(
  'gremlin_status',
  'Get full project status including config, sessions, tests, and analytics',
  {},
  async () => {
    const configPath = gremlinPath('config.json');
    const config = readJsonFile<Record<string, unknown>>(configPath);

    const sessionsDir = gremlinPath('sessions');
    let sessionCount = 0;
    let totalEvents = 0;
    const apps = new Set<string>();
    let latestSession: { id: string; timestamp: number; app: string } | undefined;
    let latestTimestamp = 0;

    if (existsSync(sessionsDir)) {
      const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
      sessionCount = files.length;

      for (const file of files) {
        try {
          const session = readJsonFile<GremlinSession>(join(sessionsDir, file));
          if (!session) continue;
          totalEvents += session.events?.length ?? 0;
          const app = session.header?.app?.name ?? 'unknown';
          apps.add(app);
          const ts = session.header?.startTime ?? 0;
          if (ts > latestTimestamp) {
            latestTimestamp = ts;
            latestSession = {
              id: session.header?.sessionId ?? file.replace('.json', ''),
              timestamp: ts,
              app,
            };
          }
        } catch {
          // skip
        }
      }
    }

    const testsDir = gremlinPath('tests');
    const analyticsDir = gremlinPath('analytics');

    const result = {
      initialized: config !== null,
      config: config
        ? {
            framework: config.framework ?? undefined,
            appName: config.appName ?? undefined,
            sdkPackage: config.sdkPackage ?? undefined,
            devServerPort: config.devServerPort ?? undefined,
            remoteServerUrl: (config.remoteServer as Record<string, unknown>)?.url ?? null,
          }
        : null,
      sessions: {
        count: sessionCount,
        latest: latestSession,
        totalEvents,
        apps: Array.from(apps),
      },
      tests: {
        specExists: existsSync(join(testsDir, 'spec.json')),
        playwright: {
          count: countFiles(join(testsDir, 'playwright'), ['.spec.ts', '.test.ts']),
          directory: '.gremlin/tests/playwright',
        },
        maestro: {
          count: countFiles(join(testsDir, 'maestro'), ['.yaml', '.yml']),
          directory: '.gremlin/tests/maestro',
        },
        fuzz: {
          count: countFiles(join(testsDir, 'fuzz'), ['.spec.ts', '.test.ts']),
          directory: '.gremlin/tests/fuzz',
        },
      },
      analytics: {
        count: countFiles(analyticsDir, ['.json']),
        directory: '.gremlin/analytics',
      },
      ai: {
        provider: process.env.ANTHROPIC_API_KEY
          ? 'anthropic'
          : process.env.OPENAI_API_KEY
            ? 'openai'
            : process.env.GEMINI_API_KEY
              ? 'gemini'
              : undefined,
        hasKey: !!(
          process.env.ANTHROPIC_API_KEY ||
          process.env.OPENAI_API_KEY ||
          process.env.GEMINI_API_KEY
        ),
      },
    };

    return textResult(result);
  }
);

// ============================================================================
// Tool: gremlin_sessions_list
// ============================================================================

server.tool(
  'gremlin_sessions_list',
  'List recorded sessions with optional filters',
  {
    app: z.string().optional().describe('Filter by app name'),
    platform: z.string().optional().describe('Filter by platform'),
    limit: z.number().optional().describe('Max sessions to return (default 20)'),
    since: z.string().optional().describe('Filter sessions after this ISO date'),
  },
  async ({ app, platform, limit, since }) => {
    const maxResults = limit ?? 20;
    const sessionsDir = gremlinPath('sessions');

    if (!existsSync(sessionsDir)) {
      return textResult({ sessions: [], total: 0 });
    }

    const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const summaries: {
      id: string;
      appName: string;
      platform: string;
      eventCount: number;
      startTime: number;
    }[] = [];

    const sinceDate = since ? new Date(since).getTime() : 0;

    for (const file of files) {
      try {
        const session = readJsonFile<GremlinSession>(join(sessionsDir, file));
        if (!session) continue;

        const sessionApp = session.header?.app?.name ?? 'unknown';
        const sessionPlatform = session.header?.device?.platform ?? 'unknown';
        const startTime = session.header?.startTime ?? 0;

        if (app && sessionApp !== app) continue;
        if (platform && sessionPlatform !== platform) continue;
        if (sinceDate && startTime < sinceDate) continue;

        summaries.push({
          id: session.header?.sessionId ?? file.replace('.json', ''),
          appName: sessionApp,
          platform: sessionPlatform,
          eventCount: session.events?.length ?? 0,
          startTime,
        });
      } catch {
        // skip
      }
    }

    summaries.sort((a, b) => b.startTime - a.startTime);

    return textResult({
      sessions: summaries.slice(0, maxResults),
      total: summaries.length,
    });
  }
);

// ============================================================================
// Tool: gremlin_session_get
// ============================================================================

server.tool(
  'gremlin_session_get',
  'Get full session data by ID',
  {
    sessionId: z.string().describe('Session ID to retrieve'),
  },
  async ({ sessionId }) => {
    const sessionPath = gremlinPath('sessions', `${sessionId}.json`);
    const session = readJsonFile<GremlinSession>(sessionPath);

    if (!session) {
      return errorResult(`Session not found: ${sessionId}`);
    }

    return textResult(session);
  }
);

// ============================================================================
// Tool: gremlin_analytics_summary
// ============================================================================

interface AnalyticsFile {
  sessionId: string;
  duration: number;
  eventCount: number;
  errorCount: number;
  screens: string[];
  platform: string;
  timestamp: string;
}

server.tool(
  'gremlin_analytics_summary',
  'Aggregate analytics across sessions',
  {
    app: z.string().optional().describe('Filter by app name'),
    since: z.string().optional().describe('Filter after this ISO date'),
  },
  async ({ since }) => {
    const analyticsDir = gremlinPath('analytics');

    if (!existsSync(analyticsDir)) {
      return textResult({
        totalSessions: 0,
        totalEvents: 0,
        totalErrors: 0,
        avgDuration: 0,
        avgEventsPerSession: 0,
        platforms: {},
        topScreens: [],
        dateRange: null,
      });
    }

    const files = readdirSync(analyticsDir).filter((f) => f.endsWith('.json'));
    const entries: AnalyticsFile[] = [];

    for (const file of files) {
      const entry = readJsonFile<AnalyticsFile>(join(analyticsDir, file));
      if (!entry) continue;

      if (since) {
        const sinceDate = new Date(since);
        const fileDate = new Date(entry.timestamp);
        if (fileDate < sinceDate) continue;
      }

      entries.push(entry);
    }

    if (entries.length === 0) {
      return textResult({
        totalSessions: 0,
        totalEvents: 0,
        totalErrors: 0,
        avgDuration: 0,
        avgEventsPerSession: 0,
        platforms: {},
        topScreens: [],
        dateRange: null,
      });
    }

    let totalEvents = 0;
    let totalErrors = 0;
    let totalDuration = 0;
    const platforms: Record<string, number> = {};
    const screenCounts: Record<string, number> = {};
    const timestamps: string[] = [];

    for (const entry of entries) {
      totalEvents += entry.eventCount;
      totalErrors += entry.errorCount;
      totalDuration += entry.duration;

      const plat = entry.platform || 'unknown';
      platforms[plat] = (platforms[plat] || 0) + 1;

      for (const screen of entry.screens) {
        screenCounts[screen] = (screenCounts[screen] || 0) + 1;
      }

      if (entry.timestamp) timestamps.push(entry.timestamp);
    }

    const topScreens = Object.entries(screenCounts)
      .map(([screen, count]) => ({ screen, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    let dateRange: { earliest: string; latest: string } | null = null;
    if (timestamps.length > 0) {
      const sorted = timestamps
        .map((t) => new Date(t))
        .sort((a, b) => a.getTime() - b.getTime());
      dateRange = {
        earliest: sorted[0].toISOString().split('T')[0],
        latest: sorted[sorted.length - 1].toISOString().split('T')[0],
      };
    }

    const totalSessions = entries.length;

    return textResult({
      totalSessions,
      totalEvents,
      totalErrors,
      avgDuration: totalDuration / totalSessions,
      avgEventsPerSession: totalEvents / totalSessions,
      platforms,
      topScreens,
      dateRange,
    });
  }
);

// ============================================================================
// Tool: gremlin_analytics_performance
// ============================================================================

server.tool(
  'gremlin_analytics_performance',
  'Aggregate performance metrics (Web Vitals, FPS, memory, long tasks) across sessions with p50/p75/p95 percentiles and CWV ratings',
  {
    app: z.string().optional().describe('Filter by app name'),
    since: z.string().optional().describe('Filter after this ISO date'),
  },
  async ({ app, since }) => {
    const sessionsDir = gremlinPath('sessions');

    if (!existsSync(sessionsDir)) {
      return textResult({
        totalSessions: 0,
        sessionsWithPerf: 0,
        webVitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
        fps: null,
        longTasks: null,
        memory: null,
      });
    }

    const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));

    interface PerfData {
      webVitals?: { lcp?: number; cls?: number; inp?: number; fcp?: number; ttfb?: number };
      avgFps?: number;
      minFps?: number;
      longTaskCount?: number;
      longTaskTotalDuration?: number;
      peakMemoryUsage?: number;
      pageLoadTime?: number;
    }

    const perfEntries: PerfData[] = [];
    let totalSessions = 0;
    const sinceDate = since ? new Date(since).getTime() : 0;

    for (const file of files) {
      try {
        const session = readJsonFile<GremlinSession>(join(sessionsDir, file));
        if (!session) continue;

        if (app && session.header?.app?.name !== app) continue;
        if (sinceDate && (session.header?.startTime ?? 0) < sinceDate) continue;

        totalSessions++;
        if (session.performance) {
          perfEntries.push(session.performance);
        }
      } catch {
        // skip
      }
    }

    if (perfEntries.length === 0) {
      return textResult({
        totalSessions,
        sessionsWithPerf: 0,
        webVitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
        fps: null,
        longTasks: null,
        memory: null,
      });
    }

    // Collect metric arrays
    const collect = (fn: (p: PerfData) => number | undefined): number[] => {
      const vals: number[] = [];
      for (const p of perfEntries) {
        const v = fn(p);
        if (v !== undefined) vals.push(v);
      }
      return vals;
    };

    const pct = (sorted: number[], p: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    };

    // CWV thresholds: [good, needs-improvement]
    const cwvThresholds: Record<string, [number, number]> = {
      lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500],
      fcp: [1800, 3000], ttfb: [800, 1800],
    };

    const computeVital = (values: number[], name: string) => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const p75 = pct(sorted, 75);
      const th = cwvThresholds[name];
      let rating: 'good' | 'needs-improvement' | 'poor' = 'good';
      if (th) {
        if (p75 > th[1]) rating = 'poor';
        else if (p75 > th[0]) rating = 'needs-improvement';
      }
      return { p50: pct(sorted, 50), p75, p95: pct(sorted, 95), rating };
    };

    const fpsValues = collect((p) => p.avgFps);
    const minFpsValues = collect((p) => p.minFps);
    const longTaskCounts = collect((p) => p.longTaskCount);
    const memoryValues = collect((p) => p.peakMemoryUsage);

    let fps = null;
    if (fpsValues.length > 0) {
      const avg = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
      const min = minFpsValues.length > 0 ? Math.min(...minFpsValues) : Math.min(...fpsValues);
      const sortedFps = [...fpsValues].sort((a, b) => a - b);
      fps = { avg, min, p5: pct(sortedFps, 5) };
    }

    let longTasks = null;
    if (longTaskCounts.length > 0) {
      const total = longTaskCounts.reduce((a, b) => a + b, 0);
      longTasks = { total, avgPerSession: total / longTaskCounts.length };
    }

    let memory = null;
    if (memoryValues.length > 0) {
      const avg = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;
      memory = { avg, peak: Math.max(...memoryValues) };
    }

    return textResult({
      totalSessions,
      sessionsWithPerf: perfEntries.length,
      webVitals: {
        lcp: computeVital(collect((p) => p.webVitals?.lcp), 'lcp'),
        cls: computeVital(collect((p) => p.webVitals?.cls), 'cls'),
        inp: computeVital(collect((p) => p.webVitals?.inp), 'inp'),
        fcp: computeVital(collect((p) => p.webVitals?.fcp), 'fcp'),
        ttfb: computeVital(collect((p) => p.webVitals?.ttfb), 'ttfb'),
      },
      fps,
      longTasks,
      memory,
    });
  }
);

// ============================================================================
// Tool: gremlin_generate_tests
// ============================================================================

server.tool(
  'gremlin_generate_tests',
  'Generate tests from recorded sessions',
  {
    provider: z.string().optional().describe('AI provider: anthropic, openai, gemini'),
    playwright: z.boolean().optional().describe('Generate Playwright tests'),
    maestro: z.boolean().optional().describe('Generate Maestro tests'),
  },
  async ({ provider, playwright, maestro }) => {
    const args: string[] = ['generate'];
    if (provider) args.push(`--provider ${provider}`);
    if (playwright) args.push('--playwright');
    if (maestro) args.push('--maestro');

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Tool: gremlin_run_tests
// ============================================================================

server.tool(
  'gremlin_run_tests',
  'Run generated tests',
  {
    testsDir: z.string().optional().describe('Tests directory (default .gremlin/tests)'),
  },
  async ({ testsDir }) => {
    const args: string[] = ['run', '--all'];
    if (testsDir) args.push(`--tests-dir ${testsDir}`);

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Tool: gremlin_instrument_info
// ============================================================================

server.tool(
  'gremlin_instrument_info',
  'Get instrumentation guidance for a framework',
  {
    framework: z.string().optional().describe('Framework: nextjs, vite, cra, remix, expo, react-native'),
  },
  async ({ framework }) => {
    // Detect framework from package.json if not provided
    let detected = framework ?? 'unknown';

    if (!framework) {
      const pkgPath = join(cwd, 'package.json');
      const pkg = readJsonFile<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(pkgPath);
      if (pkg) {
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['next']) detected = 'nextjs';
        else if (deps['@remix-run/react']) detected = 'remix';
        else if (deps['expo']) detected = 'expo';
        else if (deps['react-native'] && !deps['expo']) detected = 'react-native';
        else if (deps['vite'] && deps['react']) detected = 'vite';
        else if (deps['react-scripts']) detected = 'cra';
      }
    }

    const isNative = detected === 'expo' || detected === 'react-native';
    const sdkPackage = isNative ? '@gremlin/recorder-react-native' : '@gremlin/recorder-web';

    const entryPointHints: Record<string, string> = {
      nextjs: 'pages/_app.tsx, app/layout.tsx, or src/pages/_app.tsx',
      vite: 'src/main.tsx or src/main.jsx',
      cra: 'src/index.tsx or src/index.jsx',
      remix: 'app/root.tsx',
      expo: 'App.tsx, app/_layout.tsx (expo-router), or src/App.tsx',
      'react-native': 'App.tsx or index.js',
      unknown: 'Main app entry point where React renders',
    };

    const displayNames: Record<string, string> = {
      nextjs: 'Next.js',
      vite: 'Vite + React',
      cra: 'Create React App',
      remix: 'Remix',
      expo: 'Expo',
      'react-native': 'React Native (bare)',
      unknown: 'Unknown',
    };

    return textResult({
      framework: detected,
      frameworkDisplay: displayNames[detected] ?? detected,
      sdkPackage,
      installCommand: `bun add ${sdkPackage}`,
      entryPointHint: entryPointHints[detected] ?? entryPointHints.unknown,
      instructions: [
        `Install: bun add ${sdkPackage}`,
        `Find entry point: ${entryPointHints[detected] ?? entryPointHints.unknown}`,
        'Add recorder initialization at app root (once, not per component)',
        'Add data-testid attributes to key interactive elements',
        'Run gremlin dev to start receiving sessions',
      ],
    });
  }
);

// ============================================================================
// Tool: gremlin_analyze
// ============================================================================

server.tool(
  'gremlin_analyze',
  'AI-powered insights from recorded sessions — UX issues, errors, patterns, recommendations',
  {
    provider: z.string().optional().describe('AI provider: anthropic, openai, gemini'),
    focus: z.string().optional().describe('Focus area: ux, errors, performance, all (default: all)'),
  },
  async ({ provider, focus }) => {
    const args: string[] = ['analyze'];
    if (provider) args.push(`--provider ${provider}`);
    if (focus) args.push(`--focus ${focus}`);

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Tool: gremlin_init
// ============================================================================

server.tool(
  'gremlin_init',
  'Initialize Gremlin in the current project',
  {
    appName: z.string().optional().describe('App name for recorder config'),
    framework: z.string().optional().describe('Force framework: nextjs, vite, cra, remix, expo, react-native'),
    skipInstall: z.boolean().optional().describe('Skip SDK package installation'),
  },
  async ({ appName, framework, skipInstall }) => {
    const args: string[] = ['init'];
    if (appName) args.push(`--app-name ${appName}`);
    if (framework) args.push(`--framework ${framework}`);
    if (skipInstall) args.push('--skip-install');

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Resources
// ============================================================================

server.resource(
  'config',
  'gremlin://config',
  { description: 'Gremlin project configuration' },
  async (uri) => {
    const configPath = gremlinPath('config.json');
    const content = readJsonFile<unknown>(configPath);

    if (!content) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify({ error: 'No config found. Run gremlin init first.' }),
        }],
      };
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json' as const,
        text: JSON.stringify(content, null, 2),
      }],
    };
  }
);

server.resource(
  'sessions/{id}',
  'gremlin://sessions/{id}',
  { description: 'Read a session by ID' },
  async (uri) => {
    const id = uri.pathname.split('/').pop() ?? '';
    const sessionPath = gremlinPath('sessions', `${id}.json`);
    const content = readJsonFile<unknown>(sessionPath);

    if (!content) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify({ error: `Session not found: ${id}` }),
        }],
      };
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json' as const,
        text: JSON.stringify(content, null, 2),
      }],
    };
  }
);

server.resource(
  'spec',
  'gremlin://spec',
  { description: 'GremlinSpec test specification' },
  async (uri) => {
    const specPath = gremlinPath('tests', 'spec.json');
    const content = readJsonFile<unknown>(specPath);

    if (!content) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify({ error: 'No spec found. Run gremlin generate first.' }),
        }],
      };
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json' as const,
        text: JSON.stringify(content, null, 2),
      }],
    };
  }
);

server.resource(
  'llms.txt',
  'gremlin://llms.txt',
  { description: 'LLM-friendly instrumentation context' },
  async (uri) => {
    const llmsPath = gremlinPath('llms.txt');

    let text: string;
    try {
      text = existsSync(llmsPath) ? readFileSync(llmsPath, 'utf-8') : 'No llms.txt found. Run gremlin instrument --llms to generate.';
    } catch {
      text = 'Error reading llms.txt';
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain' as const,
        text,
      }],
    };
  }
);

// ============================================================================
// Tool: gremlin_perf_baseline
// ============================================================================

server.tool(
  'gremlin_perf_baseline',
  'Snapshot current performance metrics as a baseline for regression testing',
  {
    margin: z.number().optional().describe('Budget margin multiplier above p75 (default 1.4)'),
    update: z.boolean().optional().describe('Update existing baseline (keep tighter budgets)'),
  },
  async ({ margin, update }) => {
    const args: string[] = ['perf-baseline'];
    if (margin) args.push(`--margin ${margin}`);
    if (update) args.push('--update');

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Tool: gremlin_generate_perf_tests
// ============================================================================

server.tool(
  'gremlin_generate_perf_tests',
  'Generate Playwright performance regression tests from baseline budgets',
  {
    baseUrl: z.string().optional().describe('Base URL for web tests (default http://localhost:3000)'),
  },
  async ({ baseUrl }) => {
    const args: string[] = ['generate', '--perf'];
    if (baseUrl) args.push(`--base-url ${baseUrl}`);

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Tool: gremlin_run_perf_tests
// ============================================================================

server.tool(
  'gremlin_run_perf_tests',
  'Run performance regression tests and compare results against baseline budgets',
  {},
  async () => {
    const args: string[] = ['run', '--perf'];

    const result = runCliCommand(args.join(' '));

    try {
      return textResult(JSON.parse(result));
    } catch {
      return textResult({ output: result });
    }
  }
);

// ============================================================================
// Start Server
// ============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
