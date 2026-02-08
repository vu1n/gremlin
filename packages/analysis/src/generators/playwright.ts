/**
 * Playwright Test Generator
 *
 * Converts GremlinSpec to Playwright test files.
 * Generates tests that exercise all observed transitions.
 */

import type {
  GremlinSpec,
  State,
  Transition,
  TransitionEvent,
  ElementRef,
  Predicate,
  StateId,
} from '../spec/types';
import { extractFlows, getStateName, type Flow } from './flows';

// ============================================================================
// Types
// ============================================================================

export interface PlaywrightGeneratorOptions {
  /** Base URL for the app */
  baseUrl: string;

  /** Test file name */
  outputFile?: string;

  /** Include comments in generated code */
  includeComments?: boolean;

  /** Generate visual regression tests */
  includeVisualTests?: boolean;

  /** Maximum test timeout (ms) */
  timeout?: number;

  /** Group tests by flow or individual transitions */
  groupBy?: 'flow' | 'transition';
}

export interface GeneratedTest {
  name: string;
  code: string;
  transitions: string[];
}

// ============================================================================
// Main Generator
// ============================================================================

export function generatePlaywrightTests(
  spec: GremlinSpec,
  options: PlaywrightGeneratorOptions
): string {
  const {
    baseUrl,
    includeComments = true,
    includeVisualTests = false,
    timeout = 30000,
    groupBy = 'flow',
  } = options;

  const lines: string[] = [];

  // Header
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');

  if (includeComments) {
    lines.push(`/**`);
    lines.push(` * Auto-generated Playwright tests from GremlinSpec: ${spec.name}`);
    lines.push(` * Generated at: ${new Date().toISOString()}`);
    lines.push(` * Sessions analyzed: ${spec.metadata.sessionCount}`);
    lines.push(` */`);
    lines.push('');
  }

  // Test configuration
  lines.push(`test.describe('${spec.name}', () => {`);
  lines.push(`  test.beforeEach(async ({ page }) => {`);
  lines.push(`    await page.goto('${baseUrl}');`);
  lines.push(`  });`);
  lines.push('');

  if (groupBy === 'flow') {
    // Generate tests for complete flows (paths through the state machine)
    const flows = extractFlows(spec);
    for (const flow of flows) {
      const testCode = generateFlowTest(spec, flow, { includeComments, includeVisualTests, timeout });
      lines.push(testCode);
      lines.push('');
    }
  } else {
    // Generate individual transition tests
    for (const transition of spec.transitions) {
      const testCode = generateTransitionTest(spec, transition, { includeComments, timeout });
      lines.push(testCode);
      lines.push('');
    }
  }

  lines.push(`});`);
  lines.push('');

  // Helper functions
  lines.push(generateHelperFunctions(spec));

  return lines.join('\n');
}

// ============================================================================
// Test Generation
// ============================================================================

interface TestGenOptions {
  includeComments: boolean;
  includeVisualTests?: boolean;
  timeout: number;
}

function generateFlowTest(
  spec: GremlinSpec,
  flow: Flow,
  options: TestGenOptions
): string {
  const lines: string[] = [];
  const { includeComments, includeVisualTests, timeout } = options;

  if (includeComments) {
    lines.push(`  /**`);
    lines.push(`   * ${flow.description}`);
    lines.push(`   * Steps: ${flow.transitions.length}`);
    lines.push(`   */`);
  }

  lines.push(`  test('${flow.name}', async ({ page }) => {`);
  lines.push(`    test.setTimeout(${timeout});`);
  lines.push('');

  for (let i = 0; i < flow.transitions.length; i++) {
    const transition = flow.transitions[i];
    const fromState = spec.states.find((s) => s.id === transition.from);
    const toState = spec.states.find((s) => s.id === transition.to);

    if (includeComments) {
      lines.push(`    // Step ${i + 1}: ${fromState?.name || transition.from} → ${toState?.name || transition.to}`);
    }

    // Generate guard check if present
    if (transition.guard) {
      const guardCode = generateGuardAssertion(transition.guard);
      if (guardCode) {
        lines.push(`    ${guardCode}`);
      }
    }

    // Generate the action
    const actionCode = generateEventAction(transition.event);
    lines.push(`    ${actionCode}`);

    // Generate state assertion after transition
    if (toState) {
      const assertionCode = generateStateAssertion(toState);
      if (assertionCode) {
        lines.push(`    ${assertionCode}`);
      }
    }

    // Visual regression
    if (includeVisualTests && toState) {
      lines.push(`    await expect(page).toHaveScreenshot('${flow.name}-step-${i + 1}.png');`);
    }

    lines.push('');
  }

  lines.push(`  });`);

  return lines.join('\n');
}

function generateTransitionTest(
  spec: GremlinSpec,
  transition: Transition,
  options: TestGenOptions
): string {
  const lines: string[] = [];
  const { includeComments, timeout } = options;

  const fromState = spec.states.find((s) => s.id === transition.from);
  const toState = spec.states.find((s) => s.id === transition.to);

  const testName = `${fromState?.name || transition.from}_to_${toState?.name || transition.to}_via_${transition.event.type}`;

  if (includeComments) {
    lines.push(`  /**`);
    lines.push(`   * Transition: ${fromState?.name} → ${toState?.name}`);
    lines.push(`   * Event: ${transition.event.type}`);
    lines.push(`   * Observed ${transition.frequency} times`);
    lines.push(`   */`);
  }

  lines.push(`  test('${testName}', async ({ page }) => {`);
  lines.push(`    test.setTimeout(${timeout});`);
  lines.push('');

  // Navigate to starting state if not initial
  if (transition.from !== spec.initialState) {
    lines.push(`    await navigateToState(page, '${escapeString(fromState?.name || transition.from)}');`);
    lines.push('');
  }

  // Generate the action
  const actionCode = generateEventAction(transition.event);
  lines.push(`    ${actionCode}`);

  // Assert we're in the target state
  if (toState) {
    const assertionCode = generateStateAssertion(toState);
    if (assertionCode) {
      lines.push(`    ${assertionCode}`);
    }
  }

  lines.push(`  });`);

  return lines.join('\n');
}

// ============================================================================
// Code Generation Helpers
// ============================================================================

function generateEventAction(event: TransitionEvent): string {
  const element = event.element;

  switch (event.type) {
    case 'tap':
      return generateClickAction(element);

    case 'double_tap':
      return generateDblClickAction(element);

    case 'input':
      return generateInputAction(element, event.data);

    case 'submit':
      return generateSubmitAction(element);

    case 'scroll':
      return generateScrollAction(event.data);

    case 'navigation':
      return generateNavigationAction(event.data);

    case 'back':
      return `await page.goBack();`;

    default:
      return `// TODO: Handle ${event.type} event`;
  }
}

function generateClickAction(element?: ElementRef): string {
  const locator = generateLocator(element);
  return `await ${locator}.click();`;
}

function generateDblClickAction(element?: ElementRef): string {
  const locator = generateLocator(element);
  return `await ${locator}.dblclick();`;
}

function generateInputAction(element?: ElementRef, data?: Record<string, unknown>): string {
  const locator = generateLocator(element);
  const value = typeof data?.value === 'string' ? data.value : 'test input';
  return `await ${locator}.fill('${escapeString(value)}');`;
}

function generateSubmitAction(element?: ElementRef): string {
  if (element) {
    const locator = generateLocator(element);
    return `await ${locator}.press('Enter');`;
  }
  return `await page.keyboard.press('Enter');`;
}

function generateScrollAction(data?: Record<string, unknown>): string {
  const deltaY = typeof data?.deltaY === 'number' ? data.deltaY : 500;
  return `await page.mouse.wheel(0, ${deltaY});`;
}

function generateNavigationAction(data?: Record<string, unknown>): string {
  if (typeof data?.url === 'string') {
    return `await page.goto('${escapeString(data.url)}');`;
  }
  return `// Navigation to ${data?.screen || 'unknown'}`;
}

function generateLocator(element?: ElementRef): string {
  if (!element) {
    return `page.locator('body')`;
  }

  // Priority order for selectors
  if (element.testId) {
    // Handle wildcard testIDs (e.g., "product-card-*") by using regex or first match
    if (element.testId.includes('*')) {
      const pattern = element.testId.replace(/\*/g, '.*');
      return `page.locator('[data-testid]').filter({ has: page.locator(\`[data-testid*="${element.testId.replace(/\*/g, '')}"\`) }).first()`;
    }
    return `page.getByTestId('${element.testId}')`;
  }

  if (element.accessibilityLabel) {
    return `page.getByLabel('${escapeString(element.accessibilityLabel)}')`;
  }

  if (element.text) {
    // Use role if we know the element type
    if (element.type === 'button') {
      return `page.getByRole('button', { name: '${escapeString(element.text)}' })`;
    }
    if (element.type === 'link') {
      return `page.getByRole('link', { name: '${escapeString(element.text)}' })`;
    }
    return `page.getByText('${escapeString(element.text)}')`;
  }

  if (element.cssSelector) {
    return `page.locator('${element.cssSelector}')`;
  }

  if (element.coordinates) {
    return `page.locator('body')`;
  }

  return `page.locator('body')`;
}

function generateGuardAssertion(guard: Predicate): string | null {
  switch (guard.type) {
    case 'element_visible':
      const locator = generateLocator(guard.element);
      return `await expect(${locator}).toBeVisible();`;

    case 'element_exists':
      const existsLocator = generateLocator(guard.element);
      return `await expect(${existsLocator}).toBeAttached();`;

    case 'comparison':
      // Complex comparisons need custom handling
      return `// Guard: ${JSON.stringify(guard)}`;

    default:
      return null;
  }
}

/**
 * Generate assertion to verify we're in the expected state.
 *
 * Strategy (in priority order):
 * 1. Element-based: Check for identifying element (from metadata or invariants)
 * 2. URL-based: Use exact URL match if available
 * 3. Fallback: Wait for network idle
 *
 * Rationale: URL assertions are fragile because:
 * - SPAs may have opaque routes (/app/xyz123)
 * - URLs don't always contain readable state names
 * - Different apps use different routing patterns
 *
 * Element-based assertions are more robust:
 * - Directly verify the UI state
 * - Work with any routing strategy
 * - More maintainable
 *
 * To improve generated tests, add identifying elements to state metadata:
 * ```typescript
 * state.metadata = {
 *   identifyingElement: {
 *     testId: 'checkout-page',
 *     // or: text: 'Checkout', type: 'button'
 *   }
 * };
 * ```
 */
function generateStateAssertion(state: State): string | null {
  // Priority 1: Check if state has an identifying element in metadata
  if (state.metadata?.identifyingElement) {
    const element = state.metadata.identifyingElement as ElementRef;
    const locator = generateLocator(element);
    return `await expect(${locator}).toBeVisible();`;
  }

  // Priority 2: Check state invariants for element_visible predicates
  for (const invariant of state.invariants || []) {
    if (invariant.type === 'element_visible' && invariant.element) {
      const locator = generateLocator(invariant.element);
      return `await expect(${locator}).toBeVisible();`;
    }
  }

  // Priority 3: Check for element_exists invariants as fallback
  for (const invariant of state.invariants || []) {
    if (invariant.type === 'element_exists' && invariant.element) {
      const locator = generateLocator(invariant.element);
      return `await expect(${locator}).toBeVisible();`;
    }
  }

  // Priority 4: Use exact URL match if available (not regex)
  if (state.metadata?.url) {
    const url = state.metadata.url as string;
    // Only use URL matching if it's an exact, full URL
    try {
      const urlObj = new URL(url);
      // Use exact match, not regex pattern
      return `await expect(page).toHaveURL('${url}');`;
    } catch {
      // Invalid URL, skip this approach
    }
  }

  // Priority 5: Fallback to network idle (safest option)
  return `await page.waitForLoadState('networkidle');`;
}

// ============================================================================
// Helper Functions Generation
// ============================================================================

function generateHelperFunctions(spec: GremlinSpec): string {
  const lines: string[] = [];

  lines.push(`// ============================================================================`);
  lines.push(`// Helper Functions`);
  lines.push(`// ============================================================================`);
  lines.push('');

  // Build a navigation map: for each state, the shortest sequence of actions to reach it
  lines.push(`/**`);
  lines.push(` * Navigate to a specific state by executing the shortest path from the initial state.`);
  lines.push(` */`);
  lines.push(`async function navigateToState(page: any, targetState: string): Promise<void> {`);
  lines.push(`  const paths: Record<string, Array<() => Promise<void>>> = {`);

  // BFS from initial state to find shortest path to every reachable state
  const pathMap = computeShortestPaths(spec);

  for (const [stateId, path] of Object.entries(pathMap)) {
    const state = spec.states.find((s) => s.id === stateId);
    const stateName = state?.name || stateId;
    if (path.length === 0) continue; // Skip initial state

    const steps = path.map((t) => {
      const actionCode = generateEventAction(t.event);
      return `      async () => { ${actionCode} }`;
    });

    lines.push(`    '${escapeString(stateName)}': [`);
    for (const step of steps) {
      lines.push(`${step},`);
    }
    lines.push(`    ],`);
  }

  lines.push(`  };`);
  lines.push('');
  lines.push(`  const steps = paths[targetState];`);
  lines.push(`  if (!steps) {`);
  lines.push(`    throw new Error(\`No known path to state: \${targetState}\`);`);
  lines.push(`  }`);
  lines.push(`  for (const step of steps) {`);
  lines.push(`    await step();`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');

  // Wait for state helper — uses the same state detection logic as generateStateAssertion
  lines.push(`/**`);
  lines.push(` * Wait for the app to reach a specific state by checking its identifying element or URL.`);
  lines.push(` */`);
  lines.push(`async function waitForState(page: any, state: string, timeout = 10000): Promise<void> {`);
  lines.push(`  const detectors: Record<string, () => Promise<void>> = {`);

  for (const state of spec.states) {
    const assertion = generateStateAssertion(state);
    if (assertion) {
      lines.push(`    '${escapeString(state.name)}': async () => { ${assertion} },`);
    }
  }

  lines.push(`  };`);
  lines.push('');
  lines.push(`  const detect = detectors[state];`);
  lines.push(`  if (detect) {`);
  lines.push(`    await detect();`);
  lines.push(`  } else {`);
  lines.push(`    await page.waitForLoadState('networkidle');`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * BFS from the initial state to compute shortest transition paths to all reachable states.
 */
function computeShortestPaths(spec: GremlinSpec): Record<string, Transition[]> {
  const result: Record<string, Transition[]> = {};
  result[spec.initialState] = [];

  const queue: Array<{ stateId: StateId; path: Transition[] }> = [
    { stateId: spec.initialState, path: [] },
  ];
  const visited = new Set<string>([spec.initialState]);

  while (queue.length > 0) {
    const { stateId, path } = queue.shift()!;

    const outgoing = spec.transitions.filter((t) => t.from === stateId);
    for (const transition of outgoing) {
      if (!visited.has(transition.to)) {
        visited.add(transition.to);
        const newPath = [...path, transition];
        result[transition.to] = newPath;
        queue.push({ stateId: transition.to, path: newPath });
      }
    }
  }

  return result;
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
