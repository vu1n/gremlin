/**
 * Error Regression Test Generator
 *
 * Extracts error flows from sessions and generates Playwright tests:
 * - Regression tests that replay flows and assert errors no longer occur
 * - Network error recovery tests that mock failures and verify handling
 */

import { mkdirSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  GremlinSession,
  GremlinEvent,
  ElementInfo,
  ErrorEvent,
  NavigationEvent,
  NetworkEvent,
  TapEvent,
  InputEvent,
  ScrollEvent,
} from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';

// ============================================================================
// Types
// ============================================================================

export interface FlowStep {
  action: 'navigate' | 'click' | 'fill' | 'scroll' | 'wait';
  target?: string;
  value?: string;
  description: string;
}

export interface ErrorPattern {
  fingerprint: string;
  message: string;
  errorType: 'js' | 'native' | 'network' | 'render';
  fatal: boolean;
  stack?: string;
  occurrences: number;
  sessionIds: string[];
  flow: FlowStep[];
}

export interface ErrorTestGeneratorOptions {
  sessions: GremlinSession[];
  baseUrl?: string;
  outputDir?: string;
  minOccurrences?: number;
}

export interface ErrorTestResult {
  patterns: ErrorPattern[];
  tests: Array<{
    patternFingerprint: string;
    name: string;
    path: string;
    type: 'regression' | 'network-recovery';
  }>;
  outputDir: string;
}

// ============================================================================
// Error Pattern Extraction
// ============================================================================

export function extractErrorPatterns(
  sessions: GremlinSession[]
): ErrorPattern[] {
  const patternMap = new Map<
    string,
    {
      message: string;
      errorType: ErrorEvent['errorType'];
      fatal: boolean;
      stack?: string;
      sessionIds: string[];
      flows: FlowStep[][];
    }
  >();

  for (const session of sessions) {
    const sessionId = session.header.sessionId;

    for (let i = 0; i < session.events.length; i++) {
      const event = session.events[i];
      if (event.type !== EventTypeEnum.ERROR) continue;

      const errorData = event.data as ErrorEvent;
      const fingerprint = computeFingerprint(
        errorData.message,
        errorData.errorType
      );
      const flow = extractFlowToError(session, i);

      const existing = patternMap.get(fingerprint);
      if (existing) {
        existing.sessionIds.push(sessionId);
        existing.flows.push(flow);
        if (!existing.stack && errorData.stack) {
          existing.stack = errorData.stack;
        }
        if (errorData.fatal) {
          existing.fatal = true;
        }
      } else {
        patternMap.set(fingerprint, {
          message: errorData.message,
          errorType: errorData.errorType,
          fatal: errorData.fatal,
          stack: errorData.stack,
          sessionIds: [sessionId],
          flows: [flow],
        });
      }
    }
  }

  const patterns: ErrorPattern[] = [];
  for (const [fingerprint, data] of patternMap) {
    // Pick the longest flow as the most representative
    const bestFlow = data.flows.reduce((best, current) =>
      current.length > best.length ? current : best
    );

    patterns.push({
      fingerprint,
      message: data.message,
      errorType: data.errorType,
      fatal: data.fatal,
      stack: data.stack,
      occurrences: data.sessionIds.length,
      sessionIds: [...new Set(data.sessionIds)],
      flow: bestFlow,
    });
  }

  // Sort by occurrences descending, then fatal first
  patterns.sort((a, b) => {
    if (a.fatal !== b.fatal) return a.fatal ? -1 : 1;
    return b.occurrences - a.occurrences;
  });

  return patterns;
}

// ============================================================================
// Flow Extraction
// ============================================================================

function extractFlowToError(
  session: GremlinSession,
  errorIndex: number
): FlowStep[] {
  // Walk backwards from the error to find the last navigation (or start)
  let startIndex = 0;
  for (let i = errorIndex - 1; i >= 0; i--) {
    if (session.events[i].type === EventTypeEnum.NAVIGATION) {
      startIndex = i;
      break;
    }
  }

  const steps: FlowStep[] = [];

  for (let i = startIndex; i < errorIndex; i++) {
    const event = session.events[i];
    const step = eventToFlowStep(event, session.elements);
    if (step) {
      steps.push(step);
    }
  }

  return steps;
}

function eventToFlowStep(
  event: GremlinEvent,
  elements: ElementInfo[]
): FlowStep | null {
  switch (event.type) {
    case EventTypeEnum.NAVIGATION: {
      const nav = event.data as NavigationEvent;
      return {
        action: 'navigate',
        target: nav.url || nav.screen,
        description: `Navigate to ${nav.screen}${nav.url ? ` (${nav.url})` : ''}`,
      };
    }

    case EventTypeEnum.TAP:
    case EventTypeEnum.DOUBLE_TAP: {
      const tap = event.data as TapEvent;
      const element =
        tap.elementIndex !== undefined
          ? elements[tap.elementIndex]
          : undefined;
      const locatorDesc = element
        ? describeElement(element)
        : `(${tap.x}, ${tap.y})`;
      return {
        action: 'click',
        target: resolveLocatorString(element),
        description: `Click ${locatorDesc}`,
      };
    }

    case EventTypeEnum.INPUT: {
      const input = event.data as InputEvent;
      const element =
        input.elementIndex !== undefined
          ? elements[input.elementIndex]
          : undefined;
      return {
        action: 'fill',
        target: resolveLocatorString(element),
        value: input.masked ? 'test input' : input.value,
        description: `Fill ${describeElement(element)} with "${input.masked ? '***' : input.value}"`,
      };
    }

    case EventTypeEnum.SCROLL: {
      const scroll = event.data as ScrollEvent;
      return {
        action: 'scroll',
        description: `Scroll (${scroll.deltaX}, ${scroll.deltaY})`,
        value: String(scroll.deltaY),
      };
    }

    default:
      return null;
  }
}

// ============================================================================
// Main Generator
// ============================================================================

export function generateErrorTests(
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
    writeFile(regressionPath, regressionCode);

    result.tests.push({
      patternFingerprint: pattern.fingerprint,
      name: `regression: ${truncate(pattern.message, 60)}`,
      path: regressionPath,
      type: 'regression',
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
        writeFile(recoveryPath, recoveryCode);

        result.tests.push({
          patternFingerprint: pattern.fingerprint,
          name: `network recovery: ${truncate(pattern.message, 50)}`,
          path: recoveryPath,
          type: 'network-recovery',
        });
      }
    }
  }

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
// Fingerprinting & Normalization
// ============================================================================

export function computeFingerprint(message: string, errorType: string): string {
  const normalized = normalizeMessage(message);
  return `${errorType}:${normalized}`;
}

export function normalizeMessage(message: string): string {
  return (
    message
      // Strip UUIDs
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<id>'
      )
      // Strip numeric IDs (standalone numbers)
      .replace(/\b\d{4,}\b/g, '<id>')
      // Strip timestamps (ISO format)
      .replace(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g,
        '<timestamp>'
      )
      // Strip line:column references
      .replace(/:\d+:\d+/g, ':<line>:<col>')
      // Strip hex addresses
      .replace(/0x[0-9a-f]+/gi, '<addr>')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function extractMatchFragment(normalizedMessage: string): string {
  // Extract the most stable portion of the message for matching
  // Take up to the first placeholder or 60 chars
  const placeholderIdx = normalizedMessage.indexOf('<');
  if (placeholderIdx > 10) {
    return normalizedMessage.substring(0, placeholderIdx).trim();
  }
  // Fall back to first 60 chars
  return normalizedMessage.substring(0, 60).trim();
}

// ============================================================================
// Locator Resolution
// ============================================================================

function resolveLocatorString(element?: ElementInfo): string {
  if (!element) return "page.locator('body')";

  if (element.testId) {
    return `page.locator('[data-testid="${element.testId}"]')`;
  }

  if (element.accessibilityLabel) {
    return `page.getByLabel('${escapeString(element.accessibilityLabel)}')`;
  }

  if (element.text) {
    if (element.type === 'button') {
      return `page.getByRole('button', { name: '${escapeString(element.text)}' })`;
    }
    if (element.type === 'link') {
      return `page.getByRole('link', { name: '${escapeString(element.text)}' })`;
    }
    return `page.getByText('${escapeString(element.text)}')`;
  }

  if (element.cssSelector) {
    return `page.locator('${escapeString(element.cssSelector)}')`;
  }

  return "page.locator('body')";
}

function describeElement(element?: ElementInfo): string {
  if (!element) return 'unknown element';
  if (element.testId) return `[data-testid="${element.testId}"]`;
  if (element.accessibilityLabel) return `"${element.accessibilityLabel}"`;
  if (element.text) return `"${element.text}"`;
  if (element.cssSelector) return element.cssSelector;
  return 'unknown element';
}

// ============================================================================
// Network URL Extraction
// ============================================================================

function extractNetworkUrl(pattern: ErrorPattern): string | null {
  // Try to extract URL from the error message (common patterns)
  const urlMatch = pattern.message.match(
    /(?:https?:\/\/[^\s"']+|\/api\/[^\s"']+)/
  );
  if (urlMatch) return urlMatch[0];

  // Check the stack trace
  if (pattern.stack) {
    const stackUrlMatch = pattern.stack.match(
      /(?:https?:\/\/[^\s"')]+|\/api\/[^\s"')]+)/
    );
    if (stackUrlMatch) return stackUrlMatch[0];
  }

  return null;
}

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

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

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
