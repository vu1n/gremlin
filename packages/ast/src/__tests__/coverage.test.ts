import { describe, test, expect } from 'bun:test';
import { calculateCoverage, formatCoverageReport } from '../coverage.ts';
import type { GremlinSpecWithSources, StateWithSource, TransitionWithSource } from '../merger.ts';
import type { StateId, TransitionId } from '@gremlin/analysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sid(id: string): StateId {
  return id as StateId;
}

function tid(id: string): TransitionId {
  return id as TransitionId;
}

function makeState(
  id: string,
  name: string,
  source: 'ast' | 'session' | 'both',
  observedCount: number,
  route?: string
): StateWithSource {
  return {
    id: sid(id),
    name,
    invariants: [],
    observedCount,
    source,
    metadata: { source, route },
  } as StateWithSource;
}

function makeTransition(
  id: string,
  from: string,
  to: string,
  source: 'ast' | 'session' | 'both',
  frequency: number = 1
): TransitionWithSource {
  return {
    id: tid(id),
    from: sid(from),
    to: sid(to),
    event: { type: 'navigation' as const },
    frequency,
    source,
    metadata: { source },
  } as TransitionWithSource;
}

function makeSpec(
  states: StateWithSource[],
  transitions: TransitionWithSource[] = []
): GremlinSpecWithSources {
  return {
    name: 'test-spec',
    schemaVersion: 1,
    variables: [],
    states,
    initialState: states[0]?.id ?? sid('initial'),
    transitions,
    properties: [],
    cycles: [],
    coverage: {
      statesFromAst: 0,
      statesObserved: 0,
      coveragePercent: 0,
      unreachedStates: [],
      unexpectedFlows: [],
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionCount: 0,
      platform: 'web',
      appVersions: [],
    },
  };
}

// ---------------------------------------------------------------------------
// calculateCoverage
// ---------------------------------------------------------------------------

describe('calculateCoverage', () => {
  test('returns 0% coverage when no AST states are observed', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 0, '/'),
      makeState('s2', 'about', 'ast', 0, '/about'),
    ]);
    const result = calculateCoverage(spec);
    expect(result.coveragePercentage).toBe(0);
    expect(result.totalAstStates).toBe(2);
    expect(result.observedStates).toBe(0);
    expect(result.unreachedStates).toHaveLength(2);
  });

  test('returns 100% coverage when all AST states are observed', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'about', 'ast', 5, '/about'),
    ]);
    const result = calculateCoverage(spec);
    expect(result.coveragePercentage).toBe(100);
    expect(result.observedStates).toBe(2);
    expect(result.unreachedStates).toHaveLength(0);
  });

  test('returns 50% coverage for partially observed AST states', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'about', 'ast', 0, '/about'),
    ]);
    const result = calculateCoverage(spec);
    expect(result.coveragePercentage).toBe(50);
  });

  test('counts "both" source states as AST states', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'both', 10, '/'),
      makeState('s2', 'about', 'both', 5, '/about'),
    ]);
    const result = calculateCoverage(spec);
    expect(result.totalAstStates).toBe(2);
    expect(result.coveragePercentage).toBe(100);
  });

  test('identifies session-only states as unexpected', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'mystery-page', 'session', 3),
    ]);
    const result = calculateCoverage(spec);
    expect(result.unexpectedStates).toHaveLength(1);
    expect(result.unexpectedStates[0].name).toBe('mystery-page');
    expect(result.unexpectedStates[0].observedCount).toBe(3);
  });

  test('identifies unexpected flows involving session-only states', () => {
    const states = [
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'mystery', 'session', 3),
    ];
    const transitions = [
      makeTransition('t1', 's1', 's2', 'session', 5),
    ];
    const spec = makeSpec(states, transitions);
    const result = calculateCoverage(spec);
    expect(result.unexpectedFlows).toHaveLength(1);
    expect(result.unexpectedFlows[0].from).toBe('home');
    expect(result.unexpectedFlows[0].to).toBe('mystery');
    expect(result.unexpectedFlows[0].frequency).toBe(5);
  });

  test('computes summary statistics correctly', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 20, '/'),
      makeState('s2', 'about', 'ast', 10, '/about'),
      makeState('s3', 'contact', 'ast', 0, '/contact'),
    ]);
    const result = calculateCoverage(spec);
    expect(result.summary.totalStates).toBe(3);
    expect(result.summary.statesWithObservations).toBe(2);
    // avg = (20 + 10) / 2 = 15
    expect(result.summary.avgObservationsPerState).toBe(15);
    expect(result.summary.mostVisitedState?.name).toBe('home');
    expect(result.summary.mostVisitedState?.observedCount).toBe(20);
    expect(result.summary.leastVisitedState?.name).toBe('about');
    expect(result.summary.leastVisitedState?.observedCount).toBe(10);
  });

  test('handles 0% with no AST states (division by zero)', () => {
    const spec = makeSpec([
      makeState('s1', 'mystery', 'session', 5),
    ]);
    const result = calculateCoverage(spec);
    expect(result.coveragePercentage).toBe(0);
    expect(result.totalAstStates).toBe(0);
  });

  test('handles spec with no states', () => {
    const spec = makeSpec([]);
    const result = calculateCoverage(spec);
    expect(result.coveragePercentage).toBe(0);
    expect(result.summary.totalStates).toBe(0);
    expect(result.summary.mostVisitedState).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatCoverageReport
// ---------------------------------------------------------------------------

describe('formatCoverageReport', () => {
  test('includes coverage percentage in report', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'about', 'ast', 0, '/about'),
    ]);
    const coverage = calculateCoverage(spec);
    const report = formatCoverageReport(coverage);
    expect(report).toContain('Coverage: 50%');
    expect(report).toContain('1/2 states');
  });

  test('reports unreached states', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'settings', 'ast', 0, '/settings'),
    ]);
    const coverage = calculateCoverage(spec);
    const report = formatCoverageReport(coverage);
    expect(report).toContain('Unreached States (1)');
    expect(report).toContain('settings');
    expect(report).toContain('/settings');
  });

  test('reports all states reached', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
    ]);
    const coverage = calculateCoverage(spec);
    const report = formatCoverageReport(coverage);
    expect(report).toContain('All AST states were reached');
  });

  test('reports unexpected states', () => {
    const spec = makeSpec([
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'ghost', 'session', 2),
    ]);
    const coverage = calculateCoverage(spec);
    const report = formatCoverageReport(coverage);
    expect(report).toContain('Unexpected States (1)');
    expect(report).toContain('ghost');
  });

  test('reports unexpected flows', () => {
    const states = [
      makeState('s1', 'home', 'ast', 10, '/'),
      makeState('s2', 'unknown', 'session', 3),
    ];
    const transitions = [
      makeTransition('t1', 's1', 's2', 'session', 7),
    ];
    const spec = makeSpec(states, transitions);
    const coverage = calculateCoverage(spec);
    const report = formatCoverageReport(coverage);
    expect(report).toContain('Unexpected Flows (1)');
  });

  test('includes most/least visited state info', () => {
    const spec = makeSpec([
      makeState('s1', 'popular', 'ast', 100, '/'),
      makeState('s2', 'rare', 'ast', 1, '/rare'),
    ]);
    const coverage = calculateCoverage(spec);
    const report = formatCoverageReport(coverage);
    expect(report).toContain('Most Visited: popular');
    expect(report).toContain('Least Visited: rare');
  });
});
