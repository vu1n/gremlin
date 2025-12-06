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
// Flow Extraction
// ============================================================================

interface Flow {
  name: string;
  description: string;
  transitions: Transition[];
  startState: StateId;
  endState: StateId;
}

function extractFlows(spec: GremlinSpec): Flow[] {
  const flows: Flow[] = [];

  // Find terminal states
  const terminalStates = new Set<StateId>();
  const statesWithOutgoing = new Set<StateId>();

  for (const transition of spec.transitions) {
    statesWithOutgoing.add(transition.from);
  }

  for (const state of spec.states) {
    if (!statesWithOutgoing.has(state.id)) {
      terminalStates.add(state.id);
    }
  }

  // Find all paths from initial state to terminal states
  const visited = new Set<string>();

  function dfs(
    currentState: StateId,
    path: Transition[],
    maxDepth: number
  ): void {
    if (maxDepth <= 0) return;

    // Found a terminal state - save the flow
    if (terminalStates.has(currentState) && path.length > 0) {
      const pathKey = path.map((t) => t.id).join('->');
      if (!visited.has(pathKey)) {
        visited.add(pathKey);

        const startState = path[0].from;
        const endState = path[path.length - 1].to;

        // Generate unique name including key events in the path
        const keyEvents = path
          .slice(0, 3)
          .map((t) => t.event.element?.testId || t.event.type)
          .join('_');
        const flowIndex = flows.filter(
          (f) => f.startState === startState && f.endState === endState
        ).length;
        const uniqueSuffix = flowIndex > 0 ? `_${flowIndex + 1}` : '';

        flows.push({
          name: `${getStateName(spec, startState)}_to_${getStateName(spec, endState)}${uniqueSuffix}`,
          description: `Flow from ${getStateName(spec, startState)} to ${getStateName(spec, endState)} via ${keyEvents}`,
          transitions: [...path],
          startState,
          endState,
        });
      }
      return;
    }

    // Continue exploring
    const outgoing = spec.transitions.filter((t) => t.from === currentState);

    for (const transition of outgoing) {
      // Avoid infinite loops
      const transitionKey = `${currentState}-${transition.id}`;
      if (path.some((t) => t.id === transition.id)) continue;

      dfs(transition.to, [...path, transition], maxDepth - 1);
    }
  }

  dfs(spec.initialState, [], 10);

  // Sort by frequency (most common paths first)
  flows.sort((a, b) => {
    const freqA = a.transitions.reduce((sum, t) => sum + t.frequency, 0);
    const freqB = b.transitions.reduce((sum, t) => sum + t.frequency, 0);
    return freqB - freqA;
  });

  // Limit to top 10 flows
  return flows.slice(0, 10);
}

function getStateName(spec: GremlinSpec, stateId: StateId): string {
  const state = spec.states.find((s) => s.id === stateId);
  return state?.name || stateId;
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
    lines.push(`    // TODO: Navigate to ${fromState?.name || transition.from} state`);
    lines.push(`    // This may require executing prerequisite transitions`);
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
    return `await page.goto('${data.url}');`;
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

function generateStateAssertion(state: State): string | null {
  // Use URL from state metadata if available
  if (state.metadata?.url) {
    const url = state.metadata.url as string;
    // Extract path for regex match
    try {
      const urlObj = new URL(url);
      const pathPattern = urlObj.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `await expect(page).toHaveURL(/${pathPattern}/);`;
    } catch {
      // If not a valid URL, use it as a pattern
      return `await expect(page).toHaveURL(/${url}/);`;
    }
  }

  // Use URL patterns from description if available
  if (state.description?.includes('url:')) {
    const urlMatch = state.description.match(/url:\s*(\S+)/);
    if (urlMatch) {
      return `await expect(page).toHaveURL(/${urlMatch[1]}/);`;
    }
  }

  // Check invariants for URL-related conditions
  for (const invariant of state.invariants || []) {
    if (
      invariant.type === 'comparison' &&
      invariant.left.type === 'variable' &&
      invariant.left.name === 'url'
    ) {
      const urlValue =
        invariant.right.type === 'literal' ? String(invariant.right.value) : '';
      if (urlValue) {
        return `await expect(page).toHaveURL(/${urlValue}/);`;
      }
    }
  }

  // Fallback: wait for network idle instead of asserting specific URL
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

  // State navigation helpers
  lines.push(`/**`);
  lines.push(` * Navigate to a specific state (may require multiple transitions)`);
  lines.push(` */`);
  lines.push(`async function navigateToState(page: any, targetState: string): Promise<void> {`);
  lines.push(`  // TODO: Implement state navigation logic`);
  lines.push(`  // This should find the shortest path from current state to target`);
  lines.push(`  console.log('Navigating to state:', targetState);`);
  lines.push(`}`);
  lines.push('');

  // Wait for state helpers
  lines.push(`/**`);
  lines.push(` * Wait for the app to reach a specific state`);
  lines.push(` */`);
  lines.push(`async function waitForState(page: any, state: string, timeout = 10000): Promise<void> {`);
  lines.push(`  // TODO: Implement state detection logic`);
  lines.push(`  await page.waitForTimeout(1000);`);
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
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
