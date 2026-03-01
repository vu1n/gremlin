/**
 * Error Regression Test Generator
 *
 * Generates Playwright tests from extracted error patterns:
 * - Regression tests that replay flows and assert errors no longer occur
 * - Network error recovery tests that mock failures and verify handling
 *
 * Code generation is separated from file persistence:
 * - `planErrorTests()` returns test source strings without touching disk
 * - `writeErrorTests()` persists planned tests to the filesystem
 * - `generateErrorTests()` does both (backward-compatible convenience function)
 *
 * Pattern extraction logic lives in error-pattern-extractor.ts.
 */

import { mkdirSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { escapeString } from './utils.ts';
import {
  extractErrorPatterns,
  extractMatchFragment,
  normalizeMessage,
  resolveLocatorString,
  extractNetworkUrl,
} from './error-pattern-extractor.ts';
import type { FlowStep, ErrorPattern } from './error-pattern-extractor.ts';

// Re-export types and functions so existing consumers keep working
export type { FlowStep, ErrorPattern } from './error-pattern-extractor.ts';
export { extractErrorPatterns } from './error-pattern-extractor.ts';
export { computeFingerprint, normalizeMessage } from './error-pattern-extractor.ts';

export interface ErrorTestGeneratorOptions {
  sessions: import('@gremlin/session').GremlinSession[];
  baseUrl?: string;
  outputDir?: string;
  minOccurrences?: number;
}

export interface ErrorTestEntry {
  patternFingerprint: string;
  name: string;
  path: string;
  type: 'regression' | 'network-recovery';
  /** Generated Playwright test source code */
  source: string;
}

export interface ErrorTestResult {
  patterns: ErrorPattern[];
  tests: ErrorTestEntry[];
  outputDir: string;
}

// ============================================================================
// Planning (pure — no filesystem I/O)
// ============================================================================

/**
 * Plan error regression tests: extract patterns, generate source code strings,
 * and compute output paths — without writing anything to disk.
 */
export function planErrorTests(
  options: ErrorTestGeneratorOptions
): ErrorTestResult {
  const {
    sessions,
    baseUrl = 'http://localhost:3000',
    outputDir = '.gremlin/tests/error-regression',
    minOccurrences = 1,
  } = options;

  const allPatterns = extractErrorPatterns(sessions);
  const patterns = allPatterns.filter(
    (p) => p.occurrences >= minOccurrences
  );

  const result: ErrorTestResult = {
    patterns,
    tests: [],
    outputDir,
  };

  for (const pattern of patterns) {
    const slug = slugify(
      `${pattern.errorType}-${truncate(pattern.message, 50)}`
    );

    // Regression test
    const regressionCode = generateRegressionTest(pattern, baseUrl);
    const regressionPath = `${outputDir}/${slug}.spec.ts`;

    result.tests.push({
      patternFingerprint: pattern.fingerprint,
      name: `regression: ${truncate(pattern.message, 60)}`,
      path: regressionPath,
      type: 'regression',
      source: regressionCode,
    });

    // Network recovery test (only for network errors)
    if (pattern.errorType === 'network') {
      const networkUrl = extractNetworkUrl(pattern);
      if (networkUrl) {
        const recoveryCode = generateNetworkRecoveryTest(
          pattern,
          networkUrl,
          baseUrl
        );
        const recoveryPath = `${outputDir}/${slug}.recovery.spec.ts`;

        result.tests.push({
          patternFingerprint: pattern.fingerprint,
          name: `network recovery: ${truncate(pattern.message, 50)}`,
          path: recoveryPath,
          type: 'network-recovery',
          source: recoveryCode,
        });
      }
    }
  }

  return result;
}

// ============================================================================
// File Persistence
// ============================================================================

/**
 * Write planned error tests to disk.
 */
export function writeErrorTests(result: ErrorTestResult): void {
  for (const test of result.tests) {
    writeFile(test.path, test.source);
  }
}

// ============================================================================
// Backward-Compatible Convenience Function
// ============================================================================

/**
 * Generate error tests and write them to disk.
 * Equivalent to calling `planErrorTests()` then `writeErrorTests()`.
 */
export function generateErrorTests(
  options: ErrorTestGeneratorOptions
): ErrorTestResult {
  const result = planErrorTests(options);
  writeErrorTests(result);
  return result;
}

// ============================================================================
// Test Code Generation
// ============================================================================

function generateRegressionTest(
  pattern: ErrorPattern,
  baseUrl: string
): string {
  const lines: string[] = [];

  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(
    `test.describe('Error Regression: ${escapeString(truncate(pattern.message, 80))}', () => {`
  );
  lines.push(
    `  test('${escapeString(truncate(pattern.message, 60))} should not recur', async ({ page }) => {`
  );
  lines.push(`    const errors: string[] = [];`);
  lines.push(
    `    page.on('pageerror', (err) => errors.push(err.message));`
  );
  lines.push('');

  // Replay flow
  emitFlowSteps(lines, pattern.flow, baseUrl);

  // Assert the error no longer occurs
  const normalizedMsg = normalizeMessage(pattern.message);
  const matchFragment = extractMatchFragment(normalizedMsg);
  lines.push(
    `    // Assert the error no longer occurs`
  );
  lines.push(
    `    const matchingErrors = errors.filter(e => e.includes('${escapeString(matchFragment)}'));`
  );
  lines.push(
    `    expect(matchingErrors, 'Expected error not to recur').toHaveLength(0);`
  );
  lines.push(`  });`);
  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

function generateNetworkRecoveryTest(
  pattern: ErrorPattern,
  networkUrl: string,
  baseUrl: string
): string {
  const lines: string[] = [];
  const urlPattern = urlToRoutePattern(networkUrl);

  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(
    `test.describe('Network Error Recovery: ${escapeString(truncate(pattern.message, 60))}', () => {`
  );
  lines.push(
    `  test('${escapeString(urlPattern)} - error shown and retry works', async ({ page }) => {`
  );
  lines.push(`    // Setup: intercept the failing endpoint`);
  lines.push(
    `    await page.route('${escapeString(urlPattern)}', route => route.abort('failed'));`
  );
  lines.push('');

  // Replay flow
  emitFlowSteps(lines, pattern.flow, baseUrl);

  lines.push(`    // Verify error is handled (page does not crash)`);
  lines.push(
    `    await expect(page.locator('body')).toBeVisible();`
  );
  lines.push('');
  lines.push(`    // Remove mock and retry`);
  lines.push(`    await page.unroute('${escapeString(urlPattern)}');`);

  // Re-emit the last click action as the retry trigger
  const lastClick = [...pattern.flow]
    .reverse()
    .find((s) => s.action === 'click');
  if (lastClick?.target) {
    lines.push(`    await ${lastClick.target}.click();`);
  }

  lines.push(`  });`);
  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

function emitFlowSteps(
  lines: string[],
  flow: FlowStep[],
  baseUrl: string
): void {
  for (const step of flow) {
    lines.push(`    // ${step.description}`);

    switch (step.action) {
      case 'navigate': {
        const url = step.target?.startsWith('http')
          ? step.target
          : step.target?.startsWith('/')
            ? `${baseUrl}${step.target}`
            : `${baseUrl}/${step.target || ''}`;
        lines.push(`    await page.goto('${escapeString(url)}');`);
        break;
      }

      case 'click':
        lines.push(
          `    await ${step.target || "page.locator('body')"}.click();`
        );
        break;

      case 'fill':
        lines.push(
          `    await ${step.target || "page.locator('body')"}.fill('${escapeString(step.value || 'test input')}');`
        );
        break;

      case 'scroll': {
        const deltaY = step.value ? parseInt(step.value, 10) || 500 : 500;
        lines.push(`    await page.mouse.wheel(0, ${deltaY});`);
        break;
      }

      case 'wait':
        lines.push(
          `    await page.waitForLoadState('networkidle');`
        );
        break;
    }

    lines.push('');
  }
}

// ============================================================================
// URL Pattern
// ============================================================================

function urlToRoutePattern(url: string): string {
  try {
    const parsed = new URL(url);
    return `**${parsed.pathname}`;
  } catch {
    // If it's already a path like /api/orders
    if (url.startsWith('/')) {
      return `**${url}`;
    }
    return `**/${url}`;
  }
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

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}
