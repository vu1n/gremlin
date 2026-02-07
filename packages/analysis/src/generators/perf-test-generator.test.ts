import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { generatePerfTests, type PerfBaseline, type PerfTestGeneratorOptions } from './perf-test-generator';
import type { GremlinSession } from '@gremlin/session';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_OUTPUT_DIR = '/tmp/gremlin-perf-test-output';

function makeBaseline(overrides?: Partial<PerfBaseline>): PerfBaseline {
  return {
    version: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    sessionCount: 5,
    global: {
      webVitals: {
        lcp: { p50: 1200, p75: 1800, p95: 2500, budget: 2500 },
        fcp: { p50: 800, p75: 1200, p95: 1800, budget: 1800 },
        cls: { p50: 0.05, p75: 0.1, p95: 0.25, budget: 0.25 },
        inp: { p50: 100, p75: 200, p95: 500, budget: 500 },
        ttfb: { p50: 200, p75: 400, p95: 800, budget: 800 },
      },
      longTasks: {
        count: { p50: 2, p75: 5, p95: 10, budget: 10 },
        totalDuration: { p50: 200, p75: 500, p95: 1000, budget: 1000 },
      },
    },
    flows: {
      'Login Flow': {
        sessionIds: ['session-1', 'session-2'],
        steps: [
          { type: 'navigation', url: 'http://localhost:3000/login', screen: 'Login' },
          { type: 'input', target: 'email-input' },
          { type: 'input', target: 'password-input' },
          { type: 'tap', target: 'submit-btn' },
          { type: 'navigation', url: 'http://localhost:3000/dashboard', screen: 'Dashboard' },
        ],
        duration: { p50: 3000, p75: 5000, p95: 8000, budget: 8000 },
        longTasks: {
          count: { p50: 1, p75: 3, p95: 5, budget: 5 },
          totalDuration: { p50: 100, p75: 300, p95: 500, budget: 500 },
        },
      },
    },
    ...overrides,
  };
}

function makeSession(id: string): GremlinSession {
  return {
    header: {
      sessionId: id,
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: 'macOS 14',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: {
        name: 'TestApp',
        version: '1.0.0',
        identifier: 'com.test.app',
      },
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Performance Test Generator', () => {
  beforeEach(() => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  test('generates test files for each flow in baseline', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1'), makeSession('session-2')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.tests.length).toBe(1);
    expect(result.tests[0].flowName).toBe('Login Flow');
    expect(result.tests[0].stepCount).toBeGreaterThan(0);
    expect(result.outputDir).toBe(TEST_OUTPUT_DIR);
  });

  test('writes test files to disk', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    for (const t of result.tests) {
      expect(existsSync(t.path)).toBe(true);
    }
  });

  test('generated test code includes Playwright imports', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain("import { test, expect } from '@playwright/test'");
  });

  test('generated test code includes Web Vitals collection via addInitScript', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('addInitScript');
    expect(code).toContain('__perfMetrics');
    expect(code).toContain('largest-contentful-paint');
    expect(code).toContain('first-contentful-paint');
    expect(code).toContain('longtask');
    expect(code).toContain('PerformanceObserver');
  });

  test('generated test code asserts Web Vitals budgets', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('LCP budget exceeded');
    expect(code).toContain('toBeLessThanOrEqual(2500)');
    expect(code).toContain('FCP budget exceeded');
    expect(code).toContain('toBeLessThanOrEqual(1800)');
  });

  test('generated test code asserts flow-specific budgets', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('Flow duration budget exceeded');
    expect(code).toContain('toBeLessThanOrEqual(8000)'); // flow duration budget
    expect(code).toContain('Too many long tasks');
    expect(code).toContain('toBeLessThanOrEqual(5)'); // flow long task count budget
  });

  test('flow steps map correctly: navigation -> goto', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain("await page.goto('http://localhost:3000/login')");
  });

  test('flow steps map correctly: tap -> click', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('.click()');
  });

  test('flow steps map correctly: input -> fill', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('.fill(');
  });

  test('flow steps map correctly: subsequent navigation -> waitForURL', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    // The second navigation step (Dashboard) should use waitForURL
    expect(code).toContain('waitForURL');
    expect(code).toContain('/dashboard');
  });

  test('resolves locators for testId-like targets', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('data-testid="email-input"');
    expect(code).toContain('data-testid="submit-btn"');
  });

  test('generates Playwright config file', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.playwrightConfig).toBeDefined();
    expect(existsSync(result.playwrightConfig!)).toBe(true);

    const configCode = readFileSync(result.playwrightConfig!, 'utf-8');
    expect(configCode).toContain('defineConfig');
    expect(configCode).toContain('timeout: 60_000');
    expect(configCode).toContain('perf-results.json');
  });

  test('uses custom base URL', () => {
    const baseline = makeBaseline();
    const sessions = [makeSession('session-1')];

    const result = generatePerfTests({
      sessions,
      baseline,
      baseUrl: 'http://staging.example.com',
      outputDir: TEST_OUTPUT_DIR,
    });

    const configCode = readFileSync(result.playwrightConfig!, 'utf-8');
    expect(configCode).toContain('http://staging.example.com');
  });

  test('handles multiple flows in baseline', () => {
    const baseline = makeBaseline();
    baseline.flows['Checkout Flow'] = {
      sessionIds: ['session-1'],
      steps: [
        { type: 'navigation', url: 'http://localhost:3000/cart', screen: 'Cart' },
        { type: 'tap', target: 'checkout-btn' },
      ],
      duration: { p50: 2000, p75: 3000, p95: 5000, budget: 5000 },
      longTasks: {
        count: { p50: 1, p75: 2, p95: 3, budget: 3 },
        totalDuration: { p50: 50, p75: 100, p95: 200, budget: 200 },
      },
    };

    const sessions = [makeSession('session-1')];
    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.tests.length).toBe(2);
    const flowNames = result.tests.map((t) => t.flowName);
    expect(flowNames).toContain('Login Flow');
    expect(flowNames).toContain('Checkout Flow');
  });

  test('handles empty flows in baseline', () => {
    const baseline = makeBaseline();
    baseline.flows = {};

    const sessions = [makeSession('session-1')];
    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.tests.length).toBe(0);
  });

  test('handles flow with scroll steps', () => {
    const baseline = makeBaseline();
    baseline.flows = {
      'Scroll Flow': {
        sessionIds: ['session-1'],
        steps: [
          { type: 'navigation', url: 'http://localhost:3000/', screen: 'Home' },
          { type: 'scroll' },
        ],
        duration: { p50: 1000, p75: 2000, p95: 3000, budget: 3000 },
        longTasks: {
          count: { p50: 0, p75: 1, p95: 2, budget: 2 },
          totalDuration: { p50: 0, p75: 50, p95: 100, budget: 100 },
        },
      },
    };

    const sessions = [makeSession('session-1')];
    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain('mouse.wheel(0, 500)');
  });

  test('handles flow with screen-only navigation (no URL)', () => {
    const baseline = makeBaseline();
    baseline.flows = {
      'Screen Nav Flow': {
        sessionIds: ['session-1'],
        steps: [
          { type: 'navigation', screen: 'Profile' },
        ],
        duration: { p50: 1000, p75: 2000, p95: 3000, budget: 3000 },
        longTasks: {
          count: { p50: 0, p75: 1, p95: 2, budget: 2 },
          totalDuration: { p50: 0, p75: 50, p95: 100, budget: 100 },
        },
      },
    };

    const sessions = [makeSession('session-1')];
    const result = generatePerfTests({
      sessions,
      baseline,
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    // Screen-only nav should use waitForURL with pattern
    expect(code).toContain('profile');
  });
});
