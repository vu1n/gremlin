import { describe, test, expect } from 'bun:test';
import {
  createSpec,
  createState,
  createTransition,
  stateId,
  transitionId,
  type GremlinSpec,
  type StateId,
  type TransitionId,
} from './types.ts';

// ============================================================================
// createSpec
// ============================================================================

describe('createSpec', () => {
  test('produces valid default structure', () => {
    const spec = createSpec('my-app', 'web');

    expect(spec.name).toBe('my-app');
    expect(spec.schemaVersion).toBe(1);
    expect(spec.variables).toEqual([]);
    expect(spec.transitions).toEqual([]);
    expect(spec.properties).toEqual([]);
    expect(spec.cycles).toEqual([]);
  });

  test('creates initial state with correct defaults', () => {
    const spec = createSpec('test-spec', 'ios');

    expect(spec.states).toHaveLength(1);

    const initial = spec.states[0];
    expect(initial.id).toBe(stateId('initial'));
    expect(initial.name).toBe('Initial');
    expect(initial.source).toBe('session');
    expect(initial.invariants).toEqual([]);
    expect(initial.observedCount).toBe(0);
  });

  test('initialState references the first state', () => {
    const spec = createSpec('test', 'web');

    expect(spec.initialState).toBe(spec.states[0].id);
    expect(spec.initialState).toBe(stateId('initial'));
  });

  test('sets schemaVersion to 1', () => {
    const spec = createSpec('versioned', 'android');
    expect(spec.schemaVersion).toBe(1);
  });

  test('sets platform in metadata', () => {
    for (const platform of ['web', 'ios', 'android', 'cross-platform'] as const) {
      const spec = createSpec('app', platform);
      expect(spec.metadata.platform).toBe(platform);
    }
  });

  test('sets createdAt and updatedAt to same ISO timestamp', () => {
    const before = new Date().toISOString();
    const spec = createSpec('timed', 'web');
    const after = new Date().toISOString();

    expect(spec.metadata.createdAt).toBe(spec.metadata.updatedAt);
    expect(spec.metadata.createdAt >= before).toBe(true);
    expect(spec.metadata.createdAt <= after).toBe(true);
  });

  test('initializes sessionCount to 0', () => {
    const spec = createSpec('fresh', 'web');
    expect(spec.metadata.sessionCount).toBe(0);
  });

  test('initializes appVersions to empty array', () => {
    const spec = createSpec('fresh', 'web');
    expect(spec.metadata.appVersions).toEqual([]);
  });

  test('initializes coverage with zeroed values', () => {
    const spec = createSpec('fresh', 'web');

    expect(spec.coverage.statesFromAst).toBe(0);
    expect(spec.coverage.statesObserved).toBe(0);
    expect(spec.coverage.coveragePercent).toBe(0);
    expect(spec.coverage.unreachedStates).toEqual([]);
    expect(spec.coverage.unexpectedFlows).toEqual([]);
  });
});

// ============================================================================
// createState
// ============================================================================

describe('createState', () => {
  test('creates state with branded StateId', () => {
    const state = createState('login-page', 'Login Page');

    expect(state.id).toBe(stateId('login-page'));
    expect(state.name).toBe('Login Page');
    expect(state.source).toBe('session'); // default
    expect(state.invariants).toEqual([]);
    expect(state.observedCount).toBe(0);
  });

  test('accepts ast source', () => {
    const state = createState('checkout', 'Checkout', 'ast');
    expect(state.source).toBe('ast');
  });

  test('accepts both source', () => {
    const state = createState('home', 'Home', 'both');
    expect(state.source).toBe('both');
  });
});

// ============================================================================
// createTransition
// ============================================================================

describe('createTransition', () => {
  test('creates transition with correct fields', () => {
    const from = stateId('home');
    const to = stateId('product');
    const event = { type: 'tap' as const, element: { testId: 'product-card' } };

    const transition = createTransition('t1', from, to, event);

    expect(transition.id).toBe(transitionId('t1'));
    expect(transition.from).toBe(stateId('home'));
    expect(transition.to).toBe(stateId('product'));
    expect(transition.event).toEqual(event);
    expect(transition.frequency).toBe(0);
    expect(transition.source).toBe('session'); // default
  });

  test('accepts custom source', () => {
    const t = createTransition(
      't2',
      stateId('a'),
      stateId('b'),
      { type: 'navigation' },
      'ast'
    );
    expect(t.source).toBe('ast');
  });
});

// ============================================================================
// Branded type helpers
// ============================================================================

describe('stateId / transitionId', () => {
  test('stateId returns the same string value', () => {
    const id = stateId('my-state');
    expect(id as string).toBe('my-state');
    // It's still a string at runtime
    expect(typeof id).toBe('string');
  });

  test('transitionId returns the same string value', () => {
    const id = transitionId('t-001');
    expect(id as string).toBe('t-001');
    expect(typeof id).toBe('string');
  });
});

// ============================================================================
// Serialization round-trip
// ============================================================================

describe('serialization', () => {
  test('createSpec round-trips through JSON', () => {
    const spec = createSpec('roundtrip-app', 'web');

    const json = JSON.stringify(spec);
    const parsed = JSON.parse(json) as GremlinSpec;

    expect(parsed.name).toBe('roundtrip-app');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].id).toBe(stateId('initial'));
    expect(parsed.states[0].name).toBe('Initial');
    expect(parsed.initialState).toBe(stateId('initial'));
    expect(parsed.metadata.platform).toBe('web');
    expect(parsed.metadata.sessionCount).toBe(0);
    expect(parsed.coverage.coveragePercent).toBe(0);
  });

  test('spec with states and transitions round-trips through JSON', () => {
    const spec = createSpec('complex-app', 'ios');

    const loginState = createState('login', 'Login Screen', 'ast');
    const homeState = createState('home', 'Home Screen', 'session');
    spec.states.push(loginState, homeState);

    const t = createTransition(
      't-login-home',
      loginState.id,
      homeState.id,
      { type: 'tap', element: { testId: 'login-btn' } },
      'both'
    );
    spec.transitions.push(t);

    const json = JSON.stringify(spec);
    const parsed = JSON.parse(json) as GremlinSpec;

    // 3 states: initial + login + home
    expect(parsed.states).toHaveLength(3);
    expect(parsed.transitions).toHaveLength(1);
    expect(parsed.transitions[0].from).toBe(stateId('login'));
    expect(parsed.transitions[0].to).toBe(stateId('home'));
    expect(parsed.transitions[0].event.type).toBe('tap');
    expect(parsed.transitions[0].event.element?.testId).toBe('login-btn');
    expect(parsed.transitions[0].source).toBe('both');
  });

  test('JSON.stringify preserves all top-level keys', () => {
    const spec = createSpec('keys-test', 'web');
    const json = JSON.stringify(spec);
    const parsed = JSON.parse(json);

    const expectedKeys = [
      'name',
      'schemaVersion',
      'variables',
      'states',
      'initialState',
      'transitions',
      'properties',
      'cycles',
      'coverage',
      'metadata',
    ];

    for (const key of expectedKeys) {
      expect(key in parsed).toBe(true);
    }
  });
});
