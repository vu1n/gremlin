/**
 * Fuzz Test Generator
 *
 * Generates chaos/fuzz tests from GremlinSpec to find edge cases and bugs.
 * Implements multiple fuzzing strategies to stress-test state machines.
 */

import type {
  GremlinSpec,
  State,
  Transition,
  TransitionEvent,
  ElementRef,
  StateId,
  TransitionId,
} from '../spec/types.ts';

// ============================================================================
// Types
// ============================================================================

export interface FuzzOptions {
  /** Number of fuzz tests to generate */
  numTests?: number;

  /** Maximum steps per test */
  maxSteps?: number;

  /** Fuzzing strategies to use */
  strategies?: FuzzStrategy[];

  /** Seed for reproducible random generation */
  seed?: number;

  /** Base URL for the app (for Playwright conversion) */
  baseUrl?: string;

  /** Include comments in generated code */
  includeComments?: boolean;
}

export type FuzzStrategy =
  | 'random_walk'
  | 'boundary_abuse'
  | 'sequence_mutation'
  | 'back_button_chaos'
  | 'rapid_fire'
  | 'invalid_state_access';

export interface FuzzTest {
  /** Test name */
  name: string;

  /** Description of what this test does */
  description: string;

  /** Fuzzing strategy used */
  strategy: FuzzStrategy;

  /** Sequence of steps to execute */
  steps: FuzzStep[];

  /** Expected outcome (pass, fail, or unknown) */
  expectedOutcome?: 'pass' | 'fail' | 'unknown';

  /** What bugs this might catch */
  bugCategories?: string[];
}

export interface FuzzStep {
  /** Step type */
  type: FuzzStepType;

  /** Description of this step */
  description: string;

  /** State to be in (if applicable) */
  state?: StateId;

  /** Transition to execute (if applicable) */
  transition?: TransitionId;

  /** Event to trigger */
  event?: TransitionEvent;

  /** Custom action (for fuzzing) */
  customAction?: CustomFuzzAction;
}

export type FuzzStepType =
  | 'navigate'
  | 'action'
  | 'wait'
  | 'assertion'
  | 'fuzz_input'
  | 'back'
  | 'forward';

export interface CustomFuzzAction {
  type: 'evil_input' | 'rapid_click' | 'scroll_spam' | 'invalid_navigation';
  target?: ElementRef;
  data?: Record<string, unknown>;
}

// ============================================================================
// Main Generator
// ============================================================================

const DEFAULT_OPTIONS: Required<FuzzOptions> = {
  numTests: 10,
  maxSteps: 20,
  strategies: [
    'random_walk',
    'boundary_abuse',
    'sequence_mutation',
    'back_button_chaos',
  ],
  seed: Date.now(),
  baseUrl: 'http://localhost:3000',
  includeComments: true,
};

export function generateFuzzTests(
  spec: GremlinSpec,
  options: FuzzOptions = {}
): FuzzTest[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rng = createSeededRandom(opts.seed);
  const tests: FuzzTest[] = [];

  // Divide tests among strategies
  const testsPerStrategy = Math.ceil(opts.numTests / opts.strategies.length);

  for (const strategy of opts.strategies) {
    const numTests = Math.min(testsPerStrategy, opts.numTests - tests.length);

    for (let i = 0; i < numTests; i++) {
      const test = generateTestForStrategy(spec, strategy, opts, rng);
      if (test) {
        tests.push(test);
      }
    }

    if (tests.length >= opts.numTests) break;
  }

  return tests;
}

function generateTestForStrategy(
  spec: GremlinSpec,
  strategy: FuzzStrategy,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest | null {
  switch (strategy) {
    case 'random_walk':
      return generateRandomWalkTest(spec, options, rng);

    case 'boundary_abuse':
      return generateBoundaryAbuseTest(spec, options, rng);

    case 'sequence_mutation':
      return generateSequenceMutationTest(spec, options, rng);

    case 'back_button_chaos':
      return generateBackButtonChaosTest(spec, options, rng);

    case 'rapid_fire':
      return generateRapidFireTest(spec, options, rng);

    case 'invalid_state_access':
      return generateInvalidStateAccessTest(spec, options, rng);

    default:
      return null;
  }
}

// ============================================================================
// Strategy: Random Walk
// ============================================================================

function generateRandomWalkTest(
  spec: GremlinSpec,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest {
  const steps: FuzzStep[] = [];
  let currentState = spec.initialState;

  for (let i = 0; i < options.maxSteps; i++) {
    // Get all possible transitions from current state
    const possibleTransitions = spec.transitions.filter(
      (t) => t.from === currentState
    );

    if (possibleTransitions.length === 0) break;

    // Pick a random transition
    const transition =
      possibleTransitions[Math.floor(rng() * possibleTransitions.length)];

    steps.push({
      type: 'action',
      description: `Random action: ${transition.event.type}`,
      state: currentState,
      transition: transition.id,
      event: transition.event,
    });

    currentState = transition.to;
  }

  return {
    name: `random_walk_${generateId()}`,
    description: `Random walk through state machine with ${steps.length} steps`,
    strategy: 'random_walk',
    steps,
    expectedOutcome: 'pass',
    bugCategories: ['state machine violations', 'unexpected crashes'],
  };
}

// ============================================================================
// Strategy: Boundary Abuse
// ============================================================================

const EVIL_STRINGS = [
  '', // empty
  ' ', // whitespace
  '   ', // multiple spaces
  '\n\n\n', // newlines
  '\t\t\t', // tabs
  'A'.repeat(1000), // very long
  'A'.repeat(10000), // extremely long
  '<script>alert("xss")</script>', // XSS attempt
  '"; DROP TABLE users; --', // SQL injection
  '../../../etc/passwd', // path traversal
  '${7*7}', // template injection
  '{{7*7}}', // template injection
  '%00', // null byte
  '\u0000', // null character
  '🔥💩🎉👻🤖', // emojis
  '你好世界', // unicode
  'א ב ג', // RTL text
  '﷽', // longest unicode character
  '￾', // special unicode
  '\u202E', // RTL override
  '<img src=x onerror=alert(1)>', // XSS
  'javascript:alert(1)', // javascript protocol
  'data:text/html,<script>alert(1)</script>', // data URL
  '\'; alert(1); //', // quote escape
  '\\', // backslash
  '\r\n\r\n', // CRLF injection
];

function generateBoundaryAbuseTest(
  spec: GremlinSpec,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest | null {
  // Find all input transitions
  const inputTransitions = spec.transitions.filter(
    (t) => t.event.type === 'input'
  );

  if (inputTransitions.length === 0) return null;

  const steps: FuzzStep[] = [];
  const targetTransition =
    inputTransitions[Math.floor(rng() * inputTransitions.length)];

  // Navigate to the state with the input
  const pathToState = findPathToState(spec, spec.initialState, targetTransition.from);
  steps.push(...pathToState);

  // Try multiple evil inputs
  const numEvilInputs = Math.min(5, EVIL_STRINGS.length);
  for (let i = 0; i < numEvilInputs; i++) {
    const evilString = EVIL_STRINGS[Math.floor(rng() * EVIL_STRINGS.length)];

    steps.push({
      type: 'fuzz_input',
      description: `Evil input: ${describeEvilString(evilString)}`,
      state: targetTransition.from,
      event: {
        type: 'input',
        element: targetTransition.event.element,
        data: { value: evilString },
      },
    });

    // Try to submit
    steps.push({
      type: 'action',
      description: 'Attempt to submit evil input',
      event: {
        type: 'submit',
        element: targetTransition.event.element,
      },
    });
  }

  return {
    name: `boundary_abuse_${generateId()}`,
    description: `Test input validation with evil/boundary strings`,
    strategy: 'boundary_abuse',
    steps,
    expectedOutcome: 'unknown',
    bugCategories: [
      'input validation',
      'XSS',
      'injection',
      'buffer overflow',
      'unicode handling',
    ],
  };
}

function describeEvilString(str: string): string {
  if (str === '') return 'empty string';
  if (str.length > 100) return `very long string (${str.length} chars)`;
  if (str.includes('<script>')) return 'XSS attempt';
  if (str.includes('DROP TABLE')) return 'SQL injection';
  if (str.includes('../')) return 'path traversal';
  // Check for emojis (surrogate pairs)
  if (/[\uD800-\uDFFF]/.test(str)) return 'emoji string';
  if (/[\u0080-\uFFFF]/.test(str)) return 'unicode string';
  if (str.includes('\n')) return 'multiline string';
  return JSON.stringify(str).slice(0, 50);
}

// ============================================================================
// Strategy: Sequence Mutation
// ============================================================================

function generateSequenceMutationTest(
  spec: GremlinSpec,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest | null {
  // Extract a common flow
  const flow = extractCommonFlow(spec, rng);
  if (!flow || flow.length === 0) return null;

  // Apply mutations
  const mutationType = Math.floor(rng() * 3);
  let mutatedSteps: FuzzStep[];

  switch (mutationType) {
    case 0:
      // Shuffle steps
      mutatedSteps = shuffleArray([...flow], rng);
      break;

    case 1:
      // Repeat random steps
      mutatedSteps = [...flow];
      const repeatIdx = Math.floor(rng() * flow.length);
      const repeatCount = Math.floor(rng() * 3) + 2;
      for (let i = 0; i < repeatCount; i++) {
        mutatedSteps.splice(repeatIdx, 0, { ...flow[repeatIdx] });
      }
      break;

    case 2:
      // Skip random steps
      mutatedSteps = flow.filter(() => rng() > 0.3);
      break;

    default:
      mutatedSteps = flow;
  }

  return {
    name: `sequence_mutation_${generateId()}`,
    description: `Mutated sequence of common user flow`,
    strategy: 'sequence_mutation',
    steps: mutatedSteps,
    expectedOutcome: 'unknown',
    bugCategories: [
      'race conditions',
      'state machine violations',
      'missing validation',
    ],
  };
}

function extractCommonFlow(spec: GremlinSpec, rng: () => number): FuzzStep[] {
  // Find the most frequent path
  const sortedTransitions = [...spec.transitions].sort(
    (a, b) => b.frequency - a.frequency
  );

  const steps: FuzzStep[] = [];
  let currentState = spec.initialState;

  for (let i = 0; i < 10; i++) {
    const possibleNext = sortedTransitions.filter(
      (t) => t.from === currentState && !steps.some((s) => s.transition === t.id)
    );

    if (possibleNext.length === 0) break;

    const transition = possibleNext[0];
    steps.push({
      type: 'action',
      description: `Execute ${transition.event.type}`,
      state: currentState,
      transition: transition.id,
      event: transition.event,
    });

    currentState = transition.to;
  }

  return steps;
}

// ============================================================================
// Strategy: Back Button Chaos
// ============================================================================

function generateBackButtonChaosTest(
  spec: GremlinSpec,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest {
  const steps: FuzzStep[] = [];
  let currentState = spec.initialState;

  // Navigate forward randomly
  const forwardSteps = Math.floor(options.maxSteps * 0.6);
  for (let i = 0; i < forwardSteps; i++) {
    const possibleTransitions = spec.transitions.filter(
      (t) => t.from === currentState
    );

    if (possibleTransitions.length === 0) break;

    const transition =
      possibleTransitions[Math.floor(rng() * possibleTransitions.length)];

    steps.push({
      type: 'action',
      description: `Navigate forward: ${transition.event.type}`,
      state: currentState,
      transition: transition.id,
      event: transition.event,
    });

    currentState = transition.to;
  }

  // Now spam the back button
  const backCount = Math.floor(rng() * steps.length) + 1;
  for (let i = 0; i < backCount; i++) {
    steps.push({
      type: 'back',
      description: 'Press back button',
      event: {
        type: 'back',
      },
    });
  }

  // Try to interact with the app again
  const possibleTransitions = spec.transitions.filter(
    (t) => t.from === currentState
  );

  if (possibleTransitions.length > 0) {
    const transition =
      possibleTransitions[Math.floor(rng() * possibleTransitions.length)];

    steps.push({
      type: 'action',
      description: 'Try to interact after back spam',
      event: transition.event,
    });
  }

  return {
    name: `back_button_chaos_${generateId()}`,
    description: `Navigate forward then rapidly press back button`,
    strategy: 'back_button_chaos',
    steps,
    expectedOutcome: 'unknown',
    bugCategories: [
      'navigation bugs',
      'history management',
      'state restoration',
    ],
  };
}

// ============================================================================
// Strategy: Rapid Fire
// ============================================================================

function generateRapidFireTest(
  spec: GremlinSpec,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest {
  const steps: FuzzStep[] = [];

  // Pick a high-frequency transition
  const sortedTransitions = [...spec.transitions].sort(
    (a, b) => b.frequency - a.frequency
  );

  if (sortedTransitions.length === 0) {
    return {
      name: `rapid_fire_${generateId()}`,
      description: 'Rapid fire test (no transitions available)',
      strategy: 'rapid_fire',
      steps: [],
      expectedOutcome: 'pass',
      bugCategories: [],
    };
  }

  const targetTransition = sortedTransitions[0];

  // Navigate to the state
  const pathToState = findPathToState(
    spec,
    spec.initialState,
    targetTransition.from
  );
  steps.push(...pathToState);

  // Rapid fire the same action
  const clickCount = Math.floor(rng() * 20) + 10;
  for (let i = 0; i < clickCount; i++) {
    steps.push({
      type: 'action',
      description: `Rapid click ${i + 1}/${clickCount}`,
      state: targetTransition.from,
      event: targetTransition.event,
      customAction: {
        type: 'rapid_click',
        target: targetTransition.event.element,
      },
    });
  }

  return {
    name: `rapid_fire_${generateId()}`,
    description: `Rapidly trigger same action multiple times`,
    strategy: 'rapid_fire',
    steps,
    expectedOutcome: 'unknown',
    bugCategories: [
      'race conditions',
      'double submission',
      'event handler bugs',
    ],
  };
}

// ============================================================================
// Strategy: Invalid State Access
// ============================================================================

function generateInvalidStateAccessTest(
  spec: GremlinSpec,
  options: Required<FuzzOptions>,
  rng: () => number
): FuzzTest {
  const steps: FuzzStep[] = [];

  // Pick a random state that's not initial
  const nonInitialStates = spec.states.filter((s) => s.id !== spec.initialState);
  if (nonInitialStates.length === 0) {
    return {
      name: `invalid_state_access_${generateId()}`,
      description: 'Invalid state access (no non-initial states)',
      strategy: 'invalid_state_access',
      steps: [],
      expectedOutcome: 'pass',
      bugCategories: [],
    };
  }

  const targetState =
    nonInitialStates[Math.floor(rng() * nonInitialStates.length)];

  steps.push({
    type: 'navigate',
    description: `Try to access ${targetState.name} directly without proper navigation`,
    state: targetState.id,
    customAction: {
      type: 'invalid_navigation',
      data: {
        stateId: targetState.id,
        stateName: targetState.name,
      },
    },
  });

  // Try to interact with elements in this state
  const transitionsFromState = spec.transitions.filter(
    (t) => t.from === targetState.id
  );

  if (transitionsFromState.length > 0) {
    const transition =
      transitionsFromState[Math.floor(rng() * transitionsFromState.length)];

    steps.push({
      type: 'action',
      description: 'Try to interact in invalid state',
      event: transition.event,
    });
  }

  return {
    name: `invalid_state_access_${generateId()}`,
    description: 'Try to access state without proper navigation flow',
    strategy: 'invalid_state_access',
    steps,
    expectedOutcome: 'fail',
    bugCategories: ['authorization', 'state validation', 'deep linking'],
  };
}

// ============================================================================
// Playwright Code Generation
// ============================================================================

export function fuzzTestToPlaywright(
  test: FuzzTest,
  baseUrl: string = 'http://localhost:3000',
  includeComments: boolean = true
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
  lines.push(`  await page.goto('${baseUrl}');`);
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

function generateEventAction(event: TransitionEvent): string {
  switch (event.type) {
    case 'tap':
      return generateClickAction(event.element);

    case 'double_tap':
      return generateDblClickAction(event.element);

    case 'input':
      return generateInputAction(event.element, event.data);

    case 'submit':
      return generateSubmitAction(event.element);

    case 'scroll':
      return generateScrollAction(event.data);

    case 'back':
      return 'await page.goBack();';

    default:
      return `// TODO: Handle ${event.type} event`;
  }
}

function generateFuzzInput(event: TransitionEvent): string {
  const locator = generateLocator(event.element);
  const value =
    typeof event.data?.value === 'string' ? event.data.value : 'test';
  const escapedValue = escapeString(value);
  return `await ${locator}.fill('${escapedValue}');`;
}

function generateClickAction(element?: ElementRef): string {
  const locator = generateLocator(element);
  return `await ${locator}.click();`;
}

function generateDblClickAction(element?: ElementRef): string {
  const locator = generateLocator(element);
  return `await ${locator}.dblclick();`;
}

function generateInputAction(
  element?: ElementRef,
  data?: Record<string, unknown>
): string {
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

function generateLocator(element?: ElementRef): string {
  if (!element) {
    return `page.locator('body')`;
  }

  // Priority order for selectors
  if (element.testId) {
    return `page.getByTestId('${element.testId}')`;
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
    return `page.locator('${element.cssSelector}')`;
  }

  return `page.locator('body')`;
}

// ============================================================================
// Generate Complete Test File
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

  // Generate each test
  for (const fuzzTest of tests) {
    const testCode = fuzzTestToPlaywright(fuzzTest, baseUrl, includeComments);
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

// ============================================================================
// Utilities
// ============================================================================

function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // Simple LCG random number generator
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 8);
}

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function shuffleArray<T>(array: T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function findPathToState(
  spec: GremlinSpec,
  from: StateId,
  to: StateId
): FuzzStep[] {
  if (from === to) return [];

  // BFS to find shortest path
  const queue: { state: StateId; path: Transition[] }[] = [
    { state: from, path: [] },
  ];
  const visited = new Set<StateId>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const transition of spec.transitions) {
      if (transition.from !== current.state) continue;
      if (visited.has(transition.to)) continue;

      const newPath = [...current.path, transition];

      if (transition.to === to) {
        // Found the path!
        return newPath.map((t) => ({
          type: 'action' as const,
          description: `Navigate to ${getStateName(spec, t.to)}`,
          state: t.from,
          transition: t.id,
          event: t.event,
        }));
      }

      visited.add(transition.to);
      queue.push({ state: transition.to, path: newPath });
    }
  }

  // No path found
  return [];
}

function getStateName(spec: GremlinSpec, stateId: StateId): string {
  const state = spec.states.find((s) => s.id === stateId);
  return state?.name || stateId;
}
