/**
 * Status command unit tests
 *
 * Tests the sub-check functions that compose the status result:
 * config reading, SDK detection, session counting, test counting,
 * analytics counting, and AI provider detection.
 *
 * Uses temp directories to simulate project state.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Helpers replicated from status.ts (private functions)
// ---------------------------------------------------------------------------

interface StatusResult {
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

function countFiles(dir: string, extensions: string[]): number {
  if (!existsSync(dir)) return 0;
  try {
    const { readdirSync } = require('fs');
    return readdirSync(dir).filter((f: string) =>
      extensions.some((ext: string) => f.endsWith(ext))
    ).length;
  } catch {
    return 0;
  }
}

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-status-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// checkConfig
// ---------------------------------------------------------------------------

describe('checkConfig', () => {
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
      return null;
    }
  }

  test('returns null when .gremlin/config.json does not exist', () => {
    expect(checkConfig()).toBeNull();
  });

  test('returns config object when config.json is valid', () => {
    mkdirSync(join(tmpDir, '.gremlin'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.gremlin', 'config.json'),
      JSON.stringify({
        framework: 'nextjs',
        appName: 'TestApp',
        sdkPackage: '@gremlin/recorder-web',
        devServer: { port: 3334 },
        remoteServer: { url: null },
      })
    );

    const result = checkConfig();
    expect(result).not.toBeNull();
    expect(result!.framework).toBe('nextjs');
    expect(result!.appName).toBe('TestApp');
    expect(result!.sdkPackage).toBe('@gremlin/recorder-web');
    expect(result!.devServerPort).toBe(3334);
    expect(result!.remoteServerUrl).toBeNull();
  });

  test('returns null for malformed JSON', () => {
    mkdirSync(join(tmpDir, '.gremlin'), { recursive: true });
    writeFileSync(join(tmpDir, '.gremlin', 'config.json'), 'not json');

    expect(checkConfig()).toBeNull();
  });

  test('handles missing optional fields gracefully', () => {
    mkdirSync(join(tmpDir, '.gremlin'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.gremlin', 'config.json'),
      JSON.stringify({ framework: 'vite' })
    );

    const result = checkConfig();
    expect(result).not.toBeNull();
    expect(result!.framework).toBe('vite');
    expect(result!.appName).toBeUndefined();
    expect(result!.sdkPackage).toBeUndefined();
    expect(result!.devServerPort).toBeUndefined();
    expect(result!.remoteServerUrl).toBeNull();
  });

  test('reads remote server URL when configured', () => {
    mkdirSync(join(tmpDir, '.gremlin'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.gremlin', 'config.json'),
      JSON.stringify({
        framework: 'vite',
        remoteServer: { url: 'https://gremlin.example.com' },
      })
    );

    const result = checkConfig();
    expect(result!.remoteServerUrl).toBe('https://gremlin.example.com');
  });
});

// ---------------------------------------------------------------------------
// checkSdk
// ---------------------------------------------------------------------------

describe('checkSdk', () => {
  function checkSdk(sdkPackageHint?: string): StatusResult['sdk'] {
    const candidates = sdkPackageHint
      ? [sdkPackageHint]
      : ['@gremlin/recorder-web', '@gremlin/recorder-react-native'];

    for (const pkg of candidates) {
      const pkgJsonPath = join(
        process.cwd(),
        'node_modules',
        ...pkg.split('/'),
        'package.json'
      );
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

  test('returns installed: false when no SDK package found', () => {
    const result = checkSdk();
    expect(result.installed).toBe(false);
  });

  test('detects installed SDK with version', () => {
    const pkgDir = join(
      tmpDir,
      'node_modules',
      '@gremlin',
      'recorder-web'
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@gremlin/recorder-web', version: '1.2.3' })
    );

    const result = checkSdk('@gremlin/recorder-web');
    expect(result.installed).toBe(true);
    expect(result.package).toBe('@gremlin/recorder-web');
    expect(result.version).toBe('1.2.3');
  });

  test('detects installed SDK without hint (auto-discover)', () => {
    const pkgDir = join(
      tmpDir,
      'node_modules',
      '@gremlin',
      'recorder-react-native'
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@gremlin/recorder-react-native',
        version: '0.5.0',
      })
    );

    const result = checkSdk();
    expect(result.installed).toBe(true);
    expect(result.package).toBe('@gremlin/recorder-react-native');
    expect(result.version).toBe('0.5.0');
  });

  test('returns installed true without version on malformed package.json', () => {
    const pkgDir = join(
      tmpDir,
      'node_modules',
      '@gremlin',
      'recorder-web'
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), 'not json');

    const result = checkSdk('@gremlin/recorder-web');
    expect(result.installed).toBe(true);
    expect(result.package).toBe('@gremlin/recorder-web');
    expect(result.version).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// checkSessions
// ---------------------------------------------------------------------------

describe('checkSessions', () => {
  function checkSessions(): StatusResult['sessions'] {
    const sessionsDir = join(process.cwd(), '.gremlin', 'sessions');
    const empty: StatusResult['sessions'] = {
      count: 0,
      totalEvents: 0,
      apps: [],
    };

    if (!existsSync(sessionsDir)) return empty;

    try {
      const { readdirSync } = require('fs');
      const files = readdirSync(sessionsDir).filter((f: string) =>
        f.endsWith('.json')
      );
      if (files.length === 0) return empty;

      let totalEvents = 0;
      const appsSet = new Set<string>();
      let latestSession:
        | { id: string; timestamp: number; app: string }
        | undefined;
      let latestTimestamp = 0;

      for (const file of files) {
        try {
          const raw = readFileSync(join(sessionsDir, file), 'utf-8');
          const session = JSON.parse(raw);
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
          // skip
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

  test('returns empty when sessions directory does not exist', () => {
    const result = checkSessions();
    expect(result.count).toBe(0);
    expect(result.totalEvents).toBe(0);
    expect(result.apps).toEqual([]);
  });

  test('returns empty when sessions directory is empty', () => {
    mkdirSync(join(tmpDir, '.gremlin', 'sessions'), { recursive: true });
    const result = checkSessions();
    expect(result.count).toBe(0);
  });

  test('counts sessions and events', () => {
    const sessionsDir = join(tmpDir, '.gremlin', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(
      join(sessionsDir, 'a.json'),
      JSON.stringify({
        header: {
          sessionId: 'a',
          startTime: 1000,
          app: { name: 'App1' },
        },
        events: [{ dt: 0 }, { dt: 100 }],
      })
    );

    writeFileSync(
      join(sessionsDir, 'b.json'),
      JSON.stringify({
        header: {
          sessionId: 'b',
          startTime: 2000,
          app: { name: 'App2' },
        },
        events: [{ dt: 0 }],
      })
    );

    const result = checkSessions();
    expect(result.count).toBe(2);
    expect(result.totalEvents).toBe(3);
    expect(result.apps).toContain('App1');
    expect(result.apps).toContain('App2');
  });

  test('identifies latest session by startTime', () => {
    const sessionsDir = join(tmpDir, '.gremlin', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(
      join(sessionsDir, 'old.json'),
      JSON.stringify({
        header: {
          sessionId: 'old',
          startTime: 1000,
          app: { name: 'App' },
        },
        events: [],
      })
    );

    writeFileSync(
      join(sessionsDir, 'new.json'),
      JSON.stringify({
        header: {
          sessionId: 'new',
          startTime: 5000,
          app: { name: 'App' },
        },
        events: [],
      })
    );

    const result = checkSessions();
    expect(result.latest).toBeDefined();
    expect(result.latest!.id).toBe('new');
    expect(result.latest!.timestamp).toBe(5000);
  });

  test('skips unreadable session files', () => {
    const sessionsDir = join(tmpDir, '.gremlin', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(join(sessionsDir, 'bad.json'), 'not json');
    writeFileSync(
      join(sessionsDir, 'good.json'),
      JSON.stringify({
        header: {
          sessionId: 'good',
          startTime: 1000,
          app: { name: 'App' },
        },
        events: [{ dt: 0 }],
      })
    );

    const result = checkSessions();
    // Only 2 .json files found, but bad.json is skipped when parsing
    expect(result.count).toBe(2); // File count includes bad.json
    expect(result.totalEvents).toBe(1); // Only good.json events counted
  });
});

// ---------------------------------------------------------------------------
// checkTests
// ---------------------------------------------------------------------------

describe('checkTests', () => {
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

  test('returns all zeros when tests directory does not exist', () => {
    const result = checkTests();
    expect(result.specExists).toBe(false);
    expect(result.playwright.count).toBe(0);
    expect(result.maestro.count).toBe(0);
    expect(result.fuzz.count).toBe(0);
  });

  test('detects spec.json', () => {
    const testsDir = join(tmpDir, '.gremlin', 'tests');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(testsDir, 'spec.json'), '{}');

    const result = checkTests();
    expect(result.specExists).toBe(true);
  });

  test('counts Playwright test files', () => {
    const playwrightDir = join(tmpDir, '.gremlin', 'tests', 'playwright');
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(join(playwrightDir, 'login.spec.ts'), '');
    writeFileSync(join(playwrightDir, 'signup.test.ts'), '');
    writeFileSync(join(playwrightDir, 'README.md'), '');

    const result = checkTests();
    expect(result.playwright.count).toBe(2);
  });

  test('counts Maestro test files (.yaml and .yml)', () => {
    const maestroDir = join(tmpDir, '.gremlin', 'tests', 'maestro');
    mkdirSync(maestroDir, { recursive: true });
    writeFileSync(join(maestroDir, 'flow1.yaml'), '');
    writeFileSync(join(maestroDir, 'flow2.yml'), '');

    const result = checkTests();
    expect(result.maestro.count).toBe(2);
  });

  test('counts fuzz test files', () => {
    const fuzzDir = join(tmpDir, '.gremlin', 'tests', 'fuzz');
    mkdirSync(fuzzDir, { recursive: true });
    writeFileSync(join(fuzzDir, 'chaos.spec.ts'), '');

    const result = checkTests();
    expect(result.fuzz.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkAnalytics
// ---------------------------------------------------------------------------

describe('checkAnalytics', () => {
  function checkAnalytics(): StatusResult['analytics'] {
    const analyticsDir = join(process.cwd(), '.gremlin', 'analytics');
    return {
      count: countFiles(analyticsDir, ['.json']),
      directory: '.gremlin/analytics',
    };
  }

  test('returns 0 when analytics directory does not exist', () => {
    const result = checkAnalytics();
    expect(result.count).toBe(0);
    expect(result.directory).toBe('.gremlin/analytics');
  });

  test('counts analytics JSON files', () => {
    const analyticsDir = join(tmpDir, '.gremlin', 'analytics');
    mkdirSync(analyticsDir, { recursive: true });
    writeFileSync(join(analyticsDir, 'report-1.json'), '{}');
    writeFileSync(join(analyticsDir, 'report-2.json'), '{}');
    writeFileSync(join(analyticsDir, 'notes.txt'), '');

    const result = checkAnalytics();
    expect(result.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkAi
// ---------------------------------------------------------------------------

describe('checkAi', () => {
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

  test('detects Anthropic API key', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    try {
      const result = checkAi();
      expect(result.hasKey).toBe(true);
      expect(result.provider).toBe('anthropic');
    } finally {
      if (original !== undefined) {
        process.env.ANTHROPIC_API_KEY = original;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test('returns hasKey false when no AI keys set', () => {
    const origAnthropic = process.env.ANTHROPIC_API_KEY;
    const origOpenai = process.env.OPENAI_API_KEY;
    const origGemini = process.env.GEMINI_API_KEY;

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const result = checkAi();
      expect(result.hasKey).toBe(false);
      expect(result.provider).toBeUndefined();
    } finally {
      if (origAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropic;
      if (origOpenai !== undefined) process.env.OPENAI_API_KEY = origOpenai;
      if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
    }
  });
});

// ---------------------------------------------------------------------------
// countFiles utility
// ---------------------------------------------------------------------------

describe('countFiles', () => {
  test('returns 0 for non-existent directory', () => {
    expect(countFiles('/nonexistent/path', ['.json'])).toBe(0);
  });

  test('returns 0 for empty directory', () => {
    const dir = join(tmpDir, 'empty');
    mkdirSync(dir, { recursive: true });
    expect(countFiles(dir, ['.json'])).toBe(0);
  });

  test('counts files matching single extension', () => {
    const dir = join(tmpDir, 'files');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.json'), '');
    writeFileSync(join(dir, 'b.json'), '');
    writeFileSync(join(dir, 'c.txt'), '');

    expect(countFiles(dir, ['.json'])).toBe(2);
  });

  test('counts files matching multiple extensions', () => {
    const dir = join(tmpDir, 'multi');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.spec.ts'), '');
    writeFileSync(join(dir, 'b.test.ts'), '');
    writeFileSync(join(dir, 'c.ts'), '');

    expect(countFiles(dir, ['.spec.ts', '.test.ts'])).toBe(2);
  });
});
