/**
 * Performance Test Generator
 *
 * Generates Playwright tests that replay user flows with performance assertions.
 * Budgets are derived from session data and a perf baseline file.
 */

import { mkdirSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GremlinSession } from '@gremlin/session';

// ============================================================================
// Types
// ============================================================================

export interface PerfBaseline {
  version: 1;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  global: {
    webVitals: {
      lcp: { p50: number; p75: number; p95: number; budget: number };
      fcp: { p50: number; p75: number; p95: number; budget: number };
      cls: { p50: number; p75: number; p95: number; budget: number };
      inp: { p50: number; p75: number; p95: number; budget: number };
      ttfb: { p50: number; p75: number; p95: number; budget: number };
    };
    longTasks: {
      count: { p50: number; p75: number; p95: number; budget: number };
      totalDuration: { p50: number; p75: number; p95: number; budget: number };
    };
  };
  flows: Record<
    string,
    {
      sessionIds: string[];
      steps: Array<{
        type: string;
        target?: string;
        screen?: string;
        url?: string;
      }>;
      duration: { p50: number; p75: number; p95: number; budget: number };
      longTasks: {
        count: { p50: number; p75: number; p95: number; budget: number };
        totalDuration: { p50: number; p75: number; p95: number; budget: number };
      };
    }
  >;
}

export interface PerfTestGeneratorOptions {
  sessions: GremlinSession[];
  baseline: PerfBaseline;
  baseUrl?: string;
  outputDir?: string;
}

export interface PerfTestResult {
  tests: Array<{ flowName: string; path: string; stepCount: number }>;
  outputDir: string;
  playwrightConfig?: string;
}

// ============================================================================
// Main Generator
// ============================================================================

export function generatePerfTests(options: PerfTestGeneratorOptions): PerfTestResult {
  const {
    sessions,
    baseline,
    baseUrl = 'http://localhost:3000',
    outputDir = '.gremlin/tests/perf',
  } = options;

  const result: PerfTestResult = {
    tests: [],
    outputDir,
  };

  // Generate a test file for each flow in the baseline
  for (const [flowName, flowData] of Object.entries(baseline.flows)) {
    // Find a representative session for this flow
    const representativeSession = sessions.find((s) =>
      flowData.sessionIds.includes(s.header.sessionId)
    );

    const steps = buildFlowSteps(flowData.steps, representativeSession);
    const testCode = generateFlowTestFile(flowName, steps, flowData, baseline, baseUrl);
    const testPath = `${outputDir}/${slugify(flowName)}.spec.ts`;

    result.tests.push({
      flowName,
      path: testPath,
      stepCount: steps.length,
    });

    // Write the test file
    writeFile(testPath, testCode);
  }

  // Generate Playwright config if needed
  const configPath = `${outputDir}/playwright.perf.config.ts`;
  result.playwrightConfig = configPath;
  writeFile(configPath, generatePlaywrightConfig(outputDir, baseUrl));

  return result;
}

// ============================================================================
// Flow Step Building
// ============================================================================

interface FlowStep {
  type: 'navigate' | 'click' | 'fill' | 'scroll' | 'wait';
  description: string;
  locator?: string;
  value?: string;
  url?: string;
  urlPattern?: string;
}

function buildFlowSteps(
  baselineSteps: Array<{
    type: string;
    target?: string;
    screen?: string;
    url?: string;
  }>,
  session?: GremlinSession
): FlowStep[] {
  const steps: FlowStep[] = [];

  for (const step of baselineSteps) {
    switch (step.type) {
      case 'navigation': {
        if (step.url) {
          // First step navigates directly; subsequent steps wait for URL
          if (steps.length === 0) {
            steps.push({
              type: 'navigate',
              description: `Navigate to ${step.screen || step.url}`,
              url: step.url,
            });
          } else {
            const pattern = urlToPattern(step.url);
            steps.push({
              type: 'wait',
              description: `Navigate to ${step.screen || step.url}`,
              urlPattern: pattern,
            });
          }
        } else if (step.screen) {
          steps.push({
            type: 'wait',
            description: `Navigate to ${step.screen}`,
            urlPattern: `**/${step.screen.toLowerCase()}`,
          });
        }
        break;
      }

      case 'tap': {
        const locator = resolveLocator(step.target, session);
        steps.push({
          type: 'click',
          description: `Tap ${step.target || 'element'}`,
          locator,
        });
        break;
      }

      case 'input': {
        const inputLocator = resolveLocator(step.target, session);
        steps.push({
          type: 'fill',
          description: `Input into ${step.target || 'field'}`,
          locator: inputLocator,
          value: 'test input',
        });
        break;
      }

      case 'scroll': {
        steps.push({
          type: 'scroll',
          description: 'Scroll page',
        });
        break;
      }
    }
  }

  return steps;
}

function resolveLocator(target?: string, session?: GremlinSession): string {
  if (!target) return `page.locator('body')`;

  // If target looks like a testId, use data-testid
  if (target.match(/^[a-z0-9-]+$/i) && !target.includes(' ')) {
    return `page.locator('[data-testid="${target}"]')`;
  }

  // If target is a CSS selector already
  if (target.startsWith('.') || target.startsWith('#') || target.includes('[')) {
    return `page.locator('${escapeString(target)}')`;
  }

  // Fall back to text-based locator
  return `page.getByText('${escapeString(target)}')`;
}

function urlToPattern(url: string): string {
  try {
    const parsed = new URL(url);
    return `**${parsed.pathname}`;
  } catch {
    return `**/${url}`;
  }
}

// ============================================================================
// Test File Generation
// ============================================================================

function generateFlowTestFile(
  flowName: string,
  steps: FlowStep[],
  flowData: PerfBaseline['flows'][string],
  baseline: PerfBaseline,
  baseUrl: string
): string {
  const lines: string[] = [];

  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('Performance: ${flowName}', () => {`);
  lines.push(`  test('meets performance budgets', async ({ page }) => {`);

  // Inject Web Vitals + long task collection
  lines.push(`    // Collect Web Vitals`);
  lines.push(`    await page.addInitScript(() => {`);
  lines.push(`      (window as any).__perfMetrics = { longTasks: 0, longTaskDuration: 0 };`);
  lines.push(`      new PerformanceObserver((list) => {`);
  lines.push(`        for (const entry of list.getEntries()) {`);
  lines.push(`          if (entry.entryType === 'largest-contentful-paint') {`);
  lines.push(`            (window as any).__perfMetrics.lcp = entry.startTime;`);
  lines.push(`          }`);
  lines.push(`        }`);
  lines.push(`      }).observe({ type: 'largest-contentful-paint', buffered: true });`);
  lines.push(`      new PerformanceObserver((list) => {`);
  lines.push(`        for (const entry of list.getEntries()) {`);
  lines.push(`          if (entry.name === 'first-contentful-paint') {`);
  lines.push(`            (window as any).__perfMetrics.fcp = entry.startTime;`);
  lines.push(`          }`);
  lines.push(`        }`);
  lines.push(`      }).observe({ type: 'paint', buffered: true });`);
  lines.push(`      new PerformanceObserver((list) => {`);
  lines.push(`        for (const entry of list.getEntries()) {`);
  lines.push(`          (window as any).__perfMetrics.longTasks++;`);
  lines.push(`          (window as any).__perfMetrics.longTaskDuration += entry.duration;`);
  lines.push(`        }`);
  lines.push(`      }).observe({ type: 'longtask', buffered: true });`);
  lines.push(`    });`);
  lines.push('');

  // Start timer
  lines.push(`    const startTime = Date.now();`);
  lines.push('');

  // Generate steps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    lines.push(`    // Step ${i + 1}: ${step.description}`);

    switch (step.type) {
      case 'navigate':
        lines.push(`    await page.goto('${step.url}');`);
        break;

      case 'click':
        lines.push(`    await ${step.locator}.click();`);
        break;

      case 'fill':
        lines.push(`    await ${step.locator}.fill('${escapeString(step.value || '')}');`);
        break;

      case 'scroll':
        lines.push(`    await page.mouse.wheel(0, 500);`);
        break;

      case 'wait':
        if (step.urlPattern) {
          lines.push(`    await page.waitForURL('${step.urlPattern}');`);
        }
        break;
    }

    lines.push('');
  }

  // Calculate duration
  lines.push(`    const totalDuration = Date.now() - startTime;`);
  lines.push('');

  // Collect metrics
  lines.push(`    // Collect metrics`);
  lines.push(`    const metrics = await page.evaluate(() => (window as any).__perfMetrics);`);
  lines.push('');

  // Assert global Web Vitals budgets
  const wv = baseline.global.webVitals;
  lines.push(`    // Assert global Web Vitals budgets`);
  lines.push(`    if (metrics.lcp !== undefined) {`);
  lines.push(`      expect(metrics.lcp, 'LCP budget exceeded').toBeLessThanOrEqual(${wv.lcp.budget});`);
  lines.push(`    }`);
  lines.push(`    if (metrics.fcp !== undefined) {`);
  lines.push(`      expect(metrics.fcp, 'FCP budget exceeded').toBeLessThanOrEqual(${wv.fcp.budget});`);
  lines.push(`    }`);
  lines.push('');

  // Assert flow-specific budgets
  lines.push(`    // Assert flow-specific budgets`);
  lines.push(`    expect(totalDuration, 'Flow duration budget exceeded').toBeLessThanOrEqual(${flowData.duration.budget});`);
  lines.push(`    expect(metrics.longTasks ?? 0, 'Too many long tasks').toBeLessThanOrEqual(${flowData.longTasks.count.budget});`);

  lines.push(`  });`);
  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Playwright Config Generation
// ============================================================================

function generatePlaywrightConfig(outputDir: string, baseUrl: string): string {
  const lines: string[] = [];

  lines.push(`import { defineConfig } from '@playwright/test';`);
  lines.push('');
  lines.push(`export default defineConfig({`);
  lines.push(`  testDir: '.',`);
  lines.push(`  testMatch: '*.spec.ts',`);
  lines.push(`  timeout: 60_000,`);
  lines.push(`  retries: 1,`);
  lines.push(`  use: {`);
  lines.push(`    baseURL: '${baseUrl}',`);
  lines.push(`    trace: 'on-first-retry',`);
  lines.push(`  },`);
  lines.push(`  reporter: [['html', { open: 'never' }], ['json', { outputFile: 'perf-results.json' }]],`);
  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// File I/O
// ============================================================================

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  fsWriteFileSync(path, content, 'utf-8');
}

// ============================================================================
// Utilities
// ============================================================================

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
