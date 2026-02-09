/**
 * Status command - comprehensive project health check
 *
 * Checks initialization, SDK, servers, sessions, tests, analytics, and AI config.
 * Designed as the single most important agent command for understanding project state.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface StatusOptions extends OutputOptions {}

export interface StatusResult {
  initialized: boolean;
  config: {
    framework?: string;
    appName?: string;
    sdkPackage?: string;
    devServerPort?: number;
    remoteServerUrl?: string | null;
  } | null;
  sdk: {
    installed: boolean;
    package?: string;
    version?: string;
  } | null;
  devServer: {
    running: boolean;
    url?: string;
  } | null;
  remoteServer: {
    configured: boolean;
    url?: string;
    reachable?: boolean;
  } | null;
  sessions: {
    count: number;
    latest?: { id: string; timestamp: number; app: string };
    totalEvents: number;
    apps: string[];
  };
  tests: {
    specExists: boolean;
    playwright: { count: number; directory: string };
    maestro: { count: number; directory: string };
    fuzz: { count: number; directory: string };
  };
  analytics: {
    count: number;
    directory: string;
  };
  ai: {
    provider?: string;
    hasKey: boolean;
  };
}

// ============================================================================
// Main Command
// ============================================================================

export async function status(options: StatusOptions): Promise<StatusResult> {
  const configResult = checkConfig();
  const sdkResult = checkSdk(configResult?.sdkPackage);
  const sessionsResult = checkSessions();
  const testsResult = checkTests();
  const analyticsResult = checkAnalytics();
  const aiResult = checkAi();

  const [devServerResult, remoteServerResult] = await Promise.all([
    checkDevServer(configResult?.devServerPort),
    checkRemoteServer(configResult?.remoteServerUrl),
  ]);

  const result: StatusResult = {
    initialized: configResult !== null,
    config: configResult,
    sdk: sdkResult,
    devServer: devServerResult,
    remoteServer: remoteServerResult,
    sessions: sessionsResult,
    tests: testsResult,
    analytics: analyticsResult,
    ai: aiResult,
  };

  if (output('status', result, options)) return result;

  printHumanOutput(result);
  return result;
}

// ============================================================================
// Checks
// ============================================================================

function checkConfig(): StatusResult['config'] {
  const configPath = join(process.cwd(), '.gremlin', 'config.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return {
      framework: config.framework ?? undefined,
      appName: config.appName ?? undefined,
      sdkPackage: config.sdkPackage ?? undefined,
      devServerPort: config.devServer?.port ?? undefined,
      remoteServerUrl: config.remoteServer?.url ?? null,
    };
  } catch {
    return {};
  }
}

function checkSdk(sdkPackageHint?: string): StatusResult['sdk'] {
  const candidates = sdkPackageHint
    ? [sdkPackageHint]
    : ['@gremlin/recorder-web', '@gremlin/recorder-react-native'];

  for (const pkg of candidates) {
    const pkgJsonPath = join(process.cwd(), 'node_modules', ...pkg.split('/'), 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const raw = readFileSync(pkgJsonPath, 'utf-8');
        const pkgJson = JSON.parse(raw);
        return { installed: true, package: pkg, version: pkgJson.version };
      } catch {
        return { installed: true, package: pkg };
      }
    }
  }

  return { installed: false };
}

async function checkDevServer(portHint?: number): Promise<StatusResult['devServer']> {
  const port = portHint ?? 3334;
  const url = `http://localhost:${port}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { running: true, url };
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

async function checkRemoteServer(remoteUrl?: string | null): Promise<StatusResult['remoteServer']> {
  if (!remoteUrl) return { configured: false };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const healthUrl = remoteUrl.replace(/\/$/, '') + '/health';
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    return { configured: true, url: remoteUrl, reachable: res.ok };
  } catch {
    return { configured: true, url: remoteUrl, reachable: false };
  }
}

function checkSessions(): StatusResult['sessions'] {
  const sessionsDir = join(process.cwd(), '.gremlin', 'sessions');
  const empty: StatusResult['sessions'] = { count: 0, totalEvents: 0, apps: [] };

  if (!existsSync(sessionsDir)) return empty;

  try {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return empty;

    let totalEvents = 0;
    const appsSet = new Set<string>();
    let latestSession: { id: string; timestamp: number; app: string } | undefined;
    let latestTimestamp = 0;

    for (const file of files) {
      try {
        const raw = readFileSync(join(sessionsDir, file), 'utf-8');
        const session = JSON.parse(raw) as GremlinSession;
        const eventCount = session.events?.length ?? 0;
        totalEvents += eventCount;

        const app = session.header?.app?.name ?? 'unknown';
        appsSet.add(app);

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
        // Skip unreadable files
      }
    }

    return {
      count: files.length,
      latest: latestSession,
      totalEvents,
      apps: Array.from(appsSet),
    };
  } catch {
    return empty;
  }
}

function checkTests(): StatusResult['tests'] {
  const testsDir = join(process.cwd(), '.gremlin', 'tests');

  return {
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
  };
}

function checkAnalytics(): StatusResult['analytics'] {
  const analyticsDir = join(process.cwd(), '.gremlin', 'analytics');
  return {
    count: countFiles(analyticsDir, ['.json']),
    directory: '.gremlin/analytics',
  };
}

function checkAi(): StatusResult['ai'] {
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', hasKey: true };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', hasKey: true };
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', hasKey: true };
  }
  return { hasKey: false };
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Human Output
// ============================================================================

function printHumanOutput(result: StatusResult): void {
  console.log('');
  console.log('Gremlin Status');
  console.log('==============');
  console.log('');

  // Project
  console.log(`Project:     ${result.initialized ? 'Initialized' : 'Not initialized'}`);
  if (result.config?.framework) {
    console.log(`Framework:   ${result.config.framework}`);
  }
  if (result.config?.appName) {
    console.log(`App Name:    ${result.config.appName}`);
  }
  console.log('');

  // SDK
  if (result.sdk?.installed) {
    const version = result.sdk.version ? ` v${result.sdk.version}` : '';
    console.log(`SDK:         ${result.sdk.package}${version}`);
  } else {
    console.log('SDK:         Not installed');
  }
  console.log('');

  // Dev Server
  if (result.devServer?.running) {
    console.log(`Dev Server:  Running (${result.devServer.url})`);
  } else {
    console.log('Dev Server:  Not running');
  }

  // Remote Server
  if (result.remoteServer?.configured) {
    const status = result.remoteServer.reachable ? 'Reachable' : 'Unreachable';
    console.log(`Remote:      ${status} (${result.remoteServer.url})`);
  } else {
    console.log('Remote:      Not configured');
  }
  console.log('');

  // Sessions
  if (result.sessions.count > 0) {
    console.log(`Sessions:    ${result.sessions.count} session${result.sessions.count !== 1 ? 's' : ''} (${result.sessions.totalEvents} events)`);
    if (result.sessions.latest) {
      const idShort = result.sessions.latest.id.length > 12
        ? result.sessions.latest.id.slice(0, 12) + '...'
        : result.sessions.latest.id;
      const date = new Date(result.sessions.latest.timestamp).toISOString().split('T')[0];
      console.log(`  Latest:    ${idShort} | ${result.sessions.latest.app} | ${date}`);
    }
  } else {
    console.log('Sessions:    None');
  }
  console.log('');

  // Tests
  console.log('Tests:');
  console.log(`  Spec:      ${result.tests.specExists ? 'Found' : 'Not found'}`);
  console.log(`  Playwright: ${result.tests.playwright.count} test${result.tests.playwright.count !== 1 ? 's' : ''}`);
  console.log(`  Maestro:   ${result.tests.maestro.count} test${result.tests.maestro.count !== 1 ? 's' : ''}`);
  console.log(`  Fuzz:      ${result.tests.fuzz.count} test${result.tests.fuzz.count !== 1 ? 's' : ''}`);
  console.log('');

  // Analytics
  console.log(`Analytics:   ${result.analytics.count} report${result.analytics.count !== 1 ? 's' : ''}`);
  console.log('');

  // AI
  if (result.ai.hasKey) {
    console.log(`AI Provider: ${result.ai.provider} (key set)`);
  } else {
    console.log('AI Provider: No key configured');
  }
  console.log('');
}
