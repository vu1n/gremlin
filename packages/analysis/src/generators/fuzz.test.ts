import { describe, test, expect } from 'bun:test';
import {
  generateFuzzTests,
  fuzzTestToPlaywright,
  fuzzTestsToPlaywrightFile,
  createSeededRandom,
  EVIL_STRINGS,
  type FuzzTest,
  type FuzzStrategy,
} from './fuzz.ts';
import type { GremlinSpec } from '../spec/types.ts';
import { stateId, createSpec, createState, createTransition } from '../spec/types.ts';

// ============================================================================
// Test Helpers
// ============================================================================

function makeSpec(overrides?: Partial<GremlinSpec>): GremlinSpec {
  const spec = createSpec('TestApp', 'web');
  spec.metadata.sessionCount = 5;

  const home = createState('home', 'Home');
  home.observedCount = 10;

  const search = createState('search', 'Search');
  search.observedCount = 8;

  const results = createState('results', 'Results');
  results.observedCount = 6;

  spec.states = [home, search, results];
  spec.initialState = stateId('home');

  spec.transitions = [
    {
      ...createTransition('t1', stateId('home'), stateId('search'), {
        type: 'tap',
        element: { testId: 'search-btn', type: 'button' },
      }),
      frequency: 10,
    },
    {
      ...createTransition('t2', stateId('search'), stateId('results'), {
        type: 'input',
        element: { testId: 'search-input', type: 'input' },
        data: { value: 'test query' },
      }),
      frequency: 8,
    },
    {
      ...createTransition('t3', stateId('results'), stateId('home'), {
        type: 'tap',
        element: { testId: 'home-btn', type: 'button' },
      }),
      frequency: 5,
    },
  ];

  return { ...spec, ...overrides };
}

// ============================================================================
// Tests: Seeded Random
// ============================================================================

describe('createSeededRandom', () => {
  test('produces deterministic output for same seed', () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(42);

    const values1 = Array.from({ length: 10 }, () => rng1());
    const values2 = Array.from({ length: 10 }, () => rng2());

    expect(values1).toEqual(values2);
  });

  test('produces different output for different seeds', () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(99);

    const v1 = rng1();
    const v2 = rng2();
    expect(v1).not.toEqual(v2);
  });

  test('produces values between 0 and 1', () => {
    const rng = createSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ============================================================================
// Tests: EVIL_STRINGS
// ============================================================================

describe('EVIL_STRINGS', () => {
  test('contains common attack vectors', () => {
    const joined = EVIL_STRINGS.join(' ');
    expect(joined).toContain('<script>');
    expect(joined).toContain('DROP TABLE');
    expect(joined).toContain('../');
  });

  test('includes unicode strings', () => {
    const hasUnicode = EVIL_STRINGS.some((s) => /[\u0080-\uFFFF]/.test(s));
    expect(hasUnicode).toBe(true);
  });
});

// ============================================================================
// Tests: generateFuzzTests
// ============================================================================

describe('generateFuzzTests', () => {
  test('generates the requested number of tests', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, { numTests: 5, seed: 42 });

    expect(tests.length).toBeLessThanOrEqual(5);
    expect(tests.length).toBeGreaterThan(0);
  });

  test('seed produces reproducible output', () => {
    const spec = makeSpec();
    const tests1 = generateFuzzTests(spec, { numTests: 5, seed: 42 });
    const tests2 = generateFuzzTests(spec, { numTests: 5, seed: 42 });

    expect(tests1.length).toBe(tests2.length);
    for (let i = 0; i < tests1.length; i++) {
      expect(tests1[i].strategy).toBe(tests2[i].strategy);
      expect(tests1[i].steps.length).toBe(tests2[i].steps.length);
    }
  });

  test('distributes tests across strategies', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 8,
      seed: 42,
      strategies: ['random_walk', 'boundary_abuse', 'back_button_chaos'],
    });

    const strategies = new Set(tests.map((t) => t.strategy));
    expect(strategies.size).toBeGreaterThan(1);
  });

  test('uses default options when none provided', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec);
    expect(tests.length).toBeGreaterThan(0);
  });

  // --- Random Walk ---

  test('random_walk strategy produces valid test sequences', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 3,
      seed: 42,
      strategies: ['random_walk'],
    });

    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) {
      expect(t.strategy).toBe('random_walk');
      expect(t.steps.length).toBeGreaterThan(0);
      expect(t.expectedOutcome).toBe('pass');
      expect(t.bugCategories).toContain('state machine violations');
      // Each step should have an event from the spec transitions
      for (const step of t.steps) {
        expect(step.type).toBe('action');
        expect(step.event).toBeDefined();
      }
    }
  });

  // --- Boundary Abuse ---

  test('boundary_abuse strategy targets input transitions', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 3,
      seed: 42,
      strategies: ['boundary_abuse'],
    });

    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) {
      expect(t.strategy).toBe('boundary_abuse');
      // Should have fuzz_input steps with evil strings
      const fuzzSteps = t.steps.filter((s) => s.type === 'fuzz_input');
      expect(fuzzSteps.length).toBeGreaterThan(0);
      expect(t.bugCategories).toContain('input validation');
    }
  });

  test('boundary_abuse returns null for spec with no input transitions', () => {
    const spec = makeSpec();
    // Remove all input transitions
    spec.transitions = spec.transitions.filter((t) => t.event.type !== 'input');
    const tests = generateFuzzTests(spec, {
      numTests: 3,
      seed: 42,
      strategies: ['boundary_abuse'],
    });

    // All should be null (filtered out)
    expect(tests.length).toBe(0);
  });

  // --- Back Button Chaos ---

  test('back_button_chaos strategy includes back button presses', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 3,
      seed: 42,
      strategies: ['back_button_chaos'],
    });

    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) {
      expect(t.strategy).toBe('back_button_chaos');
      const backSteps = t.steps.filter((s) => s.type === 'back');
      expect(backSteps.length).toBeGreaterThan(0);
      expect(t.bugCategories).toContain('navigation bugs');
    }
  });

  // --- Rapid Fire ---

  test('rapid_fire strategy generates rapid click actions', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 2,
      seed: 42,
      strategies: ['rapid_fire'],
    });

    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) {
      expect(t.strategy).toBe('rapid_fire');
      const rapidSteps = t.steps.filter(
        (s) => s.customAction?.type === 'rapid_click'
      );
      expect(rapidSteps.length).toBeGreaterThan(0);
      expect(t.bugCategories).toContain('race conditions');
    }
  });

  // --- Invalid State Access ---

  test('invalid_state_access strategy tries to access non-initial states', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 2,
      seed: 42,
      strategies: ['invalid_state_access'],
    });

    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) {
      expect(t.strategy).toBe('invalid_state_access');
      const navSteps = t.steps.filter((s) => s.type === 'navigate');
      expect(navSteps.length).toBeGreaterThan(0);
      expect(t.expectedOutcome).toBe('fail');
    }
  });

  test('invalid_state_access with only initial state produces empty steps', () => {
    const spec = createSpec('SingleState', 'web');
    const home = createState('home', 'Home');
    home.observedCount = 1;
    spec.states = [home];
    spec.initialState = stateId('home');
    spec.transitions = [];

    const tests = generateFuzzTests(spec, {
      numTests: 2,
      seed: 42,
      strategies: ['invalid_state_access'],
    });

    for (const t of tests) {
      expect(t.steps.length).toBe(0);
    }
  });

  // --- Sequence Mutation ---

  test('sequence_mutation strategy mutates common flows', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 3,
      seed: 42,
      strategies: ['sequence_mutation'],
    });

    // May return empty if no flows can be extracted; that's fine
    for (const t of tests) {
      expect(t.strategy).toBe('sequence_mutation');
      expect(t.bugCategories).toContain('race conditions');
    }
  });
});

// ============================================================================
// Tests: fuzzTestToPlaywright
// ============================================================================

describe('fuzzTestToPlaywright', () => {
  test('generates valid Playwright test code', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_random_walk',
      description: 'Random walk test',
      strategy: 'random_walk',
      steps: [
        {
          type: 'action',
          description: 'Click button',
          event: {
            type: 'tap',
            element: { testId: 'my-btn' },
          },
        },
      ],
      expectedOutcome: 'pass',
    };

    const code = fuzzTestToPlaywright(fuzzTest);

    expect(code).toContain("test('test_random_walk'");
    expect(code).toContain("await page.goto('http://localhost:3000')");
    expect(code).toContain("page.getByTestId('my-btn').click()");
  });

  test('generates back/forward navigation code', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_back',
      description: 'Back button test',
      strategy: 'back_button_chaos',
      steps: [
        { type: 'back', description: 'Go back' },
        { type: 'forward', description: 'Go forward' },
      ],
    };

    const code = fuzzTestToPlaywright(fuzzTest);

    expect(code).toContain('await page.goBack()');
    expect(code).toContain('await page.goForward()');
  });

  test('generates fuzz_input code', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_fuzz_input',
      description: 'Fuzz input test',
      strategy: 'boundary_abuse',
      steps: [
        {
          type: 'fuzz_input',
          description: 'Evil input',
          event: {
            type: 'input',
            element: { testId: 'email' },
            data: { value: '<script>alert("xss")</script>' },
          },
        },
      ],
    };

    const code = fuzzTestToPlaywright(fuzzTest);

    expect(code).toContain("page.getByTestId('email')");
    expect(code).toContain('.fill(');
    expect(code).toContain('alert');
  });

  test('adds delay for rapid_click steps', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_rapid',
      description: 'Rapid test',
      strategy: 'rapid_fire',
      steps: [
        {
          type: 'action',
          description: 'Rapid click',
          event: { type: 'tap', element: { testId: 'btn' } },
          customAction: {
            type: 'rapid_click',
            target: { testId: 'btn' },
          },
        },
      ],
    };

    const code = fuzzTestToPlaywright(fuzzTest);

    expect(code).toContain('waitForTimeout(50)');
    expect(code).toContain('Rapid fire delay');
  });

  test('includes comments when enabled', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_with_comments',
      description: 'Test description',
      strategy: 'random_walk',
      steps: [{ type: 'wait', description: 'Wait step' }],
      bugCategories: ['crash'],
    };

    const code = fuzzTestToPlaywright(fuzzTest, 'http://localhost:3000', true);

    expect(code).toContain('Fuzz Test: test_with_comments');
    expect(code).toContain('Strategy: random_walk');
    expect(code).toContain('May catch: crash');
    expect(code).toContain('Step 1: Wait step');
  });

  test('omits comments when disabled', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_no_comments',
      description: 'Test desc',
      strategy: 'random_walk',
      steps: [],
    };

    const code = fuzzTestToPlaywright(fuzzTest, 'http://localhost:3000', false);

    expect(code).not.toContain('Fuzz Test:');
    expect(code).not.toContain('Strategy:');
  });

  test('uses custom base URL', () => {
    const fuzzTest: FuzzTest = {
      name: 'test_url',
      description: 'URL test',
      strategy: 'random_walk',
      steps: [],
    };

    const code = fuzzTestToPlaywright(fuzzTest, 'http://myapp.local:8080');

    expect(code).toContain("await page.goto('http://myapp.local:8080')");
  });
});

// ============================================================================
// Tests: fuzzTestsToPlaywrightFile
// ============================================================================

describe('fuzzTestsToPlaywrightFile', () => {
  test('generates complete Playwright test file', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, { numTests: 3, seed: 42 });
    const code = fuzzTestsToPlaywrightFile(spec, tests);

    expect(code).toContain("import { test, expect } from '@playwright/test'");
    expect(code).toContain("test.describe('TestApp - Fuzz Tests'");
    expect(code).toContain("await page.goto('http://localhost:3000')");
  });

  test('includes strategy info in header comment', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, {
      numTests: 4,
      seed: 42,
      strategies: ['random_walk', 'back_button_chaos'],
    });
    const code = fuzzTestsToPlaywrightFile(spec, tests, { includeComments: true });

    expect(code).toContain('Number of tests:');
    expect(code).toContain('Strategies:');
  });

  test('uses custom baseUrl', () => {
    const spec = makeSpec();
    const tests = generateFuzzTests(spec, { numTests: 2, seed: 42 });
    const code = fuzzTestsToPlaywrightFile(spec, tests, {
      baseUrl: 'http://staging.app.com',
    });

    expect(code).toContain("await page.goto('http://staging.app.com')");
  });
});
