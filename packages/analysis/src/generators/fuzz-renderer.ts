/**
 * Fuzz Test Renderer (Playwright)
 *
 * Converts FuzzTest plans into Playwright test source code.
 * Pure string generation — no filesystem I/O.
 */

import type { GremlinSpec, TransitionEvent } from '../spec/types.ts';
import type { FuzzTest, FuzzStep, FuzzOptions } from './fuzz-planner.ts';
import { escapeString } from './utils.ts';
import {
  generateLocator,
  generateEventAction,
} from './playwright-helpers.ts';

// ============================================================================
// Single Test Rendering
// ============================================================================

export function fuzzTestToPlaywright(
  test: FuzzTest,
  baseUrl: string = 'http://localhost:3000',
  includeComments: boolean = true,
  skipInitialNavigation: boolean = false
): string {
  const lines: string[] = [];

  if (includeComments) {
    lines.push(`/**`);
    lines.push(` * Fuzz Test: ${test.name}`);
    lines.push(` * Strategy: ${test.strategy}`);
    lines.push(` * Description: ${test.description}`);
    if (test.bugCategories && test.bugCategories.length > 0) {
      lines.push(` * May catch: ${test.bugCategories.join(', ')}`);
    }
    lines.push(` */`);
  }

  lines.push(`test('${test.name}', async ({ page }) => {`);
  if (!skipInitialNavigation) {
    lines.push(`  await page.goto('${baseUrl}');`);
  }
  lines.push('');

  for (let i = 0; i < test.steps.length; i++) {
    const step = test.steps[i];

    if (includeComments) {
      lines.push(`  // Step ${i + 1}: ${step.description}`);
    }

    const stepCode = generateStepCode(step);
    lines.push(`  ${stepCode}`);

    // Add small delays for rapid fire
    if (step.customAction?.type === 'rapid_click') {
      lines.push(`  await page.waitForTimeout(50); // Rapid fire delay`);
    }

    lines.push('');
  }

  lines.push(`});`);

  return lines.join('\n');
}

function generateStepCode(step: FuzzStep): string {
  switch (step.type) {
    case 'action':
      if (step.event) {
        return generateEventAction(step.event);
      }
      return '// Action (no event specified)';

    case 'fuzz_input':
      if (step.event && step.event.type === 'input') {
        return generateFuzzInput(step.event);
      }
      return '// Fuzz input (no event specified)';

    case 'back':
      return 'await page.goBack();';

    case 'forward':
      return 'await page.goForward();';

    case 'wait':
      return 'await page.waitForTimeout(1000);';

    case 'navigate':
      if (step.customAction?.type === 'invalid_navigation') {
        const stateId = step.customAction.data?.stateId || 'unknown';
        return `// Try direct navigation to ${stateId} (implementation specific)`;
      }
      return '// Navigate (implementation specific)';

    case 'assertion':
      return '// Assertion (implementation specific)';

    default:
      return '// Unknown step type';
  }
}

function generateFuzzInput(event: TransitionEvent): string {
  const locator = generateLocator(event.element);
  const value =
    typeof event.data?.value === 'string' ? event.data.value : 'test';
  const escapedValue = escapeString(value);
  return `await ${locator}.fill('${escapedValue}');`;
}

// ============================================================================
// Full Test File Rendering
// ============================================================================

export function fuzzTestsToPlaywrightFile(
  spec: GremlinSpec,
  tests: FuzzTest[],
  options: FuzzOptions = {}
): string {
  const baseUrl = options.baseUrl || 'http://localhost:3000';
  const includeComments = options.includeComments ?? true;
  const lines: string[] = [];

  // Header
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');

  if (includeComments) {
    lines.push(`/**`);
    lines.push(` * Auto-generated Fuzz Tests from GremlinSpec: ${spec.name}`);
    lines.push(` * Generated at: ${new Date().toISOString()}`);
    lines.push(` * Number of tests: ${tests.length}`);
    const uniqueStrategies = tests.map((t) => t.strategy).filter((v, i, a) => a.indexOf(v) === i);
    lines.push(` * Strategies: ${uniqueStrategies.join(', ')}`);
    lines.push(` */`);
    lines.push('');
  }

  // Test suite
  lines.push(`test.describe('${spec.name} - Fuzz Tests', () => {`);
  lines.push(`  test.beforeEach(async ({ page }) => {`);
  lines.push(`    await page.goto('${baseUrl}');`);
  lines.push(`  });`);
  lines.push('');

  // Generate each test (skip initial navigation since beforeEach handles it)
  for (const fuzzTest of tests) {
    const testCode = fuzzTestToPlaywright(fuzzTest, baseUrl, includeComments, true);
    const indentedCode = testCode
      .split('\n')
      .map((line) => (line ? `  ${line}` : ''))
      .join('\n');
    lines.push(indentedCode);
    lines.push('');
  }

  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}
