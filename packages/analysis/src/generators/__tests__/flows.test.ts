/**
 * Tests for flow extraction logic (extractFlows, getStateName)
 *
 * Covers:
 * - extractFlows: extracts flows from spec with states and transitions
 * - Handles specs with no transitions (produces fallback flows)
 * - Flow naming includes numeric suffix
 * - DFS traversal finds connected paths
 * - Handles cycles in state graph
 */

import { describe, test, expect } from 'bun:test';
import { extractFlows, getStateName } from '../flows.ts';
import type { Flow } from '../flows.ts';
import type { GremlinSpec, TransitionEvent } from '../../spec/types.ts';
import { stateId, createSpec, createState, createTransition } from '../../spec/types.ts';

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(type: string, testId?: string): TransitionEvent {
  return {
    type: type as TransitionEvent['type'],
    element: testId ? { testId } : undefined,
  };
}

function buildSpec(overrides: Partial<GremlinSpec> = {}): GremlinSpec {
  const base = createSpec('test-spec', 'web');
  return { ...base, ...overrides };
}

// ============================================================================
// getStateName
// ============================================================================

describe('getStateName', () => {
  test('returns state name when state exists', () => {
    const spec = buildSpec({
      states: [
        createState('home', 'Home Page'),
        createState('about', 'About Page'),
      ],
    });

    expect(getStateName(spec, stateId('home'))).toBe('Home Page');
    expect(getStateName(spec, stateId('about'))).toBe('About Page');
  });

  test('returns stateId as fallback when state not found', () => {
    const spec = buildSpec({ states: [] });
    expect(getStateName(spec, stateId('missing'))).toBe('missing');
  });
});

// ============================================================================
// extractFlows - basic
// ============================================================================

describe('extractFlows', () => {
  test('extracts a single flow from initial to terminal state', () => {
    const homeState = createState('home', 'Home');
    const checkoutState = createState('checkout', 'Checkout');

    const t1 = createTransition(
      't1',
      stateId('home'),
      stateId('checkout'),
      makeEvent('tap', 'buy-btn'),
    );
    t1.frequency = 5;

    const spec = buildSpec({
      states: [homeState, checkoutState],
      initialState: stateId('home'),
      transitions: [t1],
    });

    const flows = extractFlows(spec);

    expect(flows.length).toBe(1);
    expect(flows[0].startState).toBe(stateId('home'));
    expect(flows[0].endState).toBe(stateId('checkout'));
    expect(flows[0].transitions).toHaveLength(1);
  });

  test('extracts multiple flows to different terminal states', () => {
    const home = createState('home', 'Home');
    const about = createState('about', 'About');
    const contact = createState('contact', 'Contact');

    const t1 = createTransition('t1', stateId('home'), stateId('about'), makeEvent('tap', 'about-link'));
    t1.frequency = 3;
    const t2 = createTransition('t2', stateId('home'), stateId('contact'), makeEvent('tap', 'contact-link'));
    t2.frequency = 2;

    const spec = buildSpec({
      states: [home, about, contact],
      initialState: stateId('home'),
      transitions: [t1, t2],
    });

    const flows = extractFlows(spec);

    expect(flows.length).toBe(2);
    // Sorted by frequency descending
    expect(flows[0].endState).toBe(stateId('about'));
    expect(flows[1].endState).toBe(stateId('contact'));
  });

  test('extracts multi-step flows through intermediate states', () => {
    const home = createState('home', 'Home');
    const products = createState('products', 'Products');
    const checkout = createState('checkout', 'Checkout');

    const t1 = createTransition('t1', stateId('home'), stateId('products'), makeEvent('tap', 'shop'));
    t1.frequency = 10;
    const t2 = createTransition('t2', stateId('products'), stateId('checkout'), makeEvent('tap', 'buy'));
    t2.frequency = 5;

    const spec = buildSpec({
      states: [home, products, checkout],
      initialState: stateId('home'),
      transitions: [t1, t2],
    });

    const flows = extractFlows(spec);

    expect(flows.length).toBe(1);
    expect(flows[0].transitions).toHaveLength(2);
    expect(flows[0].startState).toBe(stateId('home'));
    expect(flows[0].endState).toBe(stateId('checkout'));
  });

  test('returns empty array when spec has no transitions', () => {
    const home = createState('home', 'Home');

    const spec = buildSpec({
      states: [home],
      initialState: stateId('home'),
      transitions: [],
    });

    const flows = extractFlows(spec);

    expect(flows).toHaveLength(0);
  });
});

// ============================================================================
// extractFlows - naming
// ============================================================================

describe('extractFlows - naming', () => {
  test('flow name includes numeric suffix', () => {
    const home = createState('home', 'Home');
    const done = createState('done', 'Done');

    const t1 = createTransition('t1', stateId('home'), stateId('done'), makeEvent('tap', 'btn-a'));
    t1.frequency = 1;

    const spec = buildSpec({
      states: [home, done],
      initialState: stateId('home'),
      transitions: [t1],
    });

    const flows = extractFlows(spec);

    expect(flows[0].name).toMatch(/_\d+$/);
    expect(flows[0].name).toContain('Home');
    expect(flows[0].name).toContain('Done');
  });

  test('flow description contains "Flow from" and state names', () => {
    const home = createState('home', 'Home');
    const end = createState('end', 'End');

    const t1 = createTransition('t1', stateId('home'), stateId('end'), makeEvent('tap'));
    t1.frequency = 1;

    const spec = buildSpec({
      states: [home, end],
      initialState: stateId('home'),
      transitions: [t1],
    });

    const flows = extractFlows(spec);

    expect(flows[0].description).toContain('Flow from');
    expect(flows[0].description).toContain('Home');
    expect(flows[0].description).toContain('End');
  });
});

// ============================================================================
// extractFlows - cycles
// ============================================================================

describe('extractFlows - cycles', () => {
  test('handles cycles without infinite looping', () => {
    const home = createState('home', 'Home');
    const products = createState('products', 'Products');

    // Create a cycle: home -> products -> home (and products has no terminal)
    const t1 = createTransition('t1', stateId('home'), stateId('products'), makeEvent('tap'));
    t1.frequency = 5;
    const t2 = createTransition('t2', stateId('products'), stateId('home'), makeEvent('tap'));
    t2.frequency = 3;

    const spec = buildSpec({
      states: [home, products],
      initialState: stateId('home'),
      transitions: [t1, t2],
    });

    // Should not hang; falls through to fallback since no terminal states exist
    const flows = extractFlows(spec);

    // Even with cycles, extractFlows should return results (fallback paths)
    expect(Array.isArray(flows)).toBe(true);
  });

  test('avoids revisiting the same transition in a single path', () => {
    const a = createState('a', 'A');
    const b = createState('b', 'B');
    const c = createState('c', 'C');

    // a -> b -> a -> c (cycle through a) but c is terminal
    const t1 = createTransition('t1', stateId('a'), stateId('b'), makeEvent('tap'));
    t1.frequency = 3;
    const t2 = createTransition('t2', stateId('b'), stateId('a'), makeEvent('tap'));
    t2.frequency = 2;
    const t3 = createTransition('t3', stateId('a'), stateId('c'), makeEvent('tap'));
    t3.frequency = 1;

    const spec = buildSpec({
      states: [a, b, c],
      initialState: stateId('a'),
      transitions: [t1, t2, t3],
    });

    const flows = extractFlows(spec);

    // Should find paths to c (the terminal state)
    const toCFlows = flows.filter(f => f.endState === stateId('c'));
    expect(toCFlows.length).toBeGreaterThanOrEqual(1);

    // Each flow's transitions should not contain duplicates
    for (const flow of flows) {
      const ids = flow.transitions.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    }
  });
});

// ============================================================================
// extractFlows - fallback for SPAs
// ============================================================================

describe('extractFlows - fallback (no terminal states)', () => {
  test('produces fallback flows when all states have outgoing transitions', () => {
    const a = createState('a', 'A');
    const b = createState('b', 'B');
    const c = createState('c', 'C');

    // a -> b -> c -> a (full cycle, no terminal states)
    const t1 = createTransition('t1', stateId('a'), stateId('b'), makeEvent('navigation'));
    t1.frequency = 10;
    const t2 = createTransition('t2', stateId('b'), stateId('c'), makeEvent('navigation'));
    t2.frequency = 5;
    const t3 = createTransition('t3', stateId('c'), stateId('a'), makeEvent('navigation'));
    t3.frequency = 3;

    const spec = buildSpec({
      states: [a, b, c],
      initialState: stateId('a'),
      transitions: [t1, t2, t3],
    });

    const flows = extractFlows(spec);

    // Fallback DFS should still produce flows
    expect(flows.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// extractFlows - sorting & limits
// ============================================================================

describe('extractFlows - sorting', () => {
  test('flows are sorted by total frequency descending', () => {
    const home = createState('home', 'Home');
    const a = createState('a', 'PageA');
    const b = createState('b', 'PageB');

    const t1 = createTransition('t1', stateId('home'), stateId('a'), makeEvent('tap', 'link-a'));
    t1.frequency = 2;
    const t2 = createTransition('t2', stateId('home'), stateId('b'), makeEvent('tap', 'link-b'));
    t2.frequency = 10;

    const spec = buildSpec({
      states: [home, a, b],
      initialState: stateId('home'),
      transitions: [t1, t2],
    });

    const flows = extractFlows(spec);

    expect(flows.length).toBe(2);
    // Higher frequency first
    const freq0 = flows[0].transitions.reduce((s, t) => s + t.frequency, 0);
    const freq1 = flows[1].transitions.reduce((s, t) => s + t.frequency, 0);
    expect(freq0).toBeGreaterThanOrEqual(freq1);
  });
});
