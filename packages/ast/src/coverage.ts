/**
 * Coverage Analysis - Calculate coverage delta between AST and observed sessions
 */

import type { GremlinSpecWithSources, StateWithSource, TransitionWithSource } from './merger.js';
import type { StateId } from '@gremlin/analysis';

/**
 * Coverage information for a GremlinSpec
 */
export interface CoverageInfo {
  /** Total states defined in AST */
  totalAstStates: number;

  /** States observed in sessions */
  observedStates: number;

  /** Coverage percentage (0-100) */
  coveragePercentage: number;

  /** States in AST but never visited */
  unreachedStates: StateInfo[];

  /** States observed but not in AST routes */
  unexpectedStates: StateInfo[];

  /** Transitions observed but not expected from AST */
  unexpectedFlows: TransitionInfo[];

  /** Summary statistics */
  summary: CoverageSummary;
}

export interface StateInfo {
  id: StateId;
  name: string;
  route?: string;
  observedCount: number;
}

export interface TransitionInfo {
  from: string;
  to: string;
  frequency: number;
}

export interface CoverageSummary {
  /** Total states (AST + unexpected) */
  totalStates: number;

  /** Total transitions */
  totalTransitions: number;

  /** States with observations */
  statesWithObservations: number;

  /** Average observations per state */
  avgObservationsPerState: number;

  /** Most visited state */
  mostVisitedState?: StateInfo;

  /** Least visited state (excluding unreached) */
  leastVisitedState?: StateInfo;
}

/**
 * Calculate coverage information for a spec
 */
export function calculateCoverage(spec: GremlinSpecWithSources): CoverageInfo {
  const astStates = spec.states.filter(
    s => s.metadata.source === 'ast' || s.metadata.source === 'both'
  );
  const sessionStates = spec.states.filter(s => s.observedCount > 0);
  const unexpectedStates = spec.states.filter(s => s.metadata.source === 'session');

  // Calculate unreached states (in AST but never observed)
  const unreachedStates: StateInfo[] = astStates
    .filter(s => s.observedCount === 0)
    .map(s => ({
      id: s.id,
      name: s.name,
      route: (s.metadata as StateWithSource['metadata']).route,
      observedCount: s.observedCount,
    }));

  // Get unexpected states info
  const unexpectedStateInfos: StateInfo[] = unexpectedStates.map(s => ({
    id: s.id,
    name: s.name,
    observedCount: s.observedCount,
  }));

  // Calculate coverage percentage
  const totalAstStates = astStates.length;
  const observedAstStates = astStates.filter(s => s.observedCount > 0).length;
  const coveragePercentage = totalAstStates > 0
    ? Math.round((observedAstStates / totalAstStates) * 100)
    : 0;

  // Find unexpected flows (transitions not matching AST structure)
  const unexpectedFlows: TransitionInfo[] = [];
  for (const transition of spec.transitions as TransitionWithSource[]) {
    // A flow is unexpected if it connects states where at least one is session-only
    const fromState = spec.states.find(s => s.id === transition.from);
    const toState = spec.states.find(s => s.id === transition.to);

    if (
      fromState?.metadata.source === 'session' ||
      toState?.metadata.source === 'session'
    ) {
      unexpectedFlows.push({
        from: fromState?.name ?? transition.from,
        to: toState?.name ?? transition.to,
        frequency: transition.frequency,
      });
    }
  }

  // Calculate summary statistics
  const statesWithObservations = spec.states.filter(s => s.observedCount > 0);
  const totalObservations = spec.states.reduce((sum, s) => sum + s.observedCount, 0);
  const avgObservationsPerState = statesWithObservations.length > 0
    ? Math.round(totalObservations / statesWithObservations.length)
    : 0;

  // Find most and least visited states
  const sortedByObservations = [...statesWithObservations].sort(
    (a, b) => b.observedCount - a.observedCount
  );

  const mostVisitedState = sortedByObservations.length > 0
    ? {
        id: sortedByObservations[0].id,
        name: sortedByObservations[0].name,
        route: (sortedByObservations[0].metadata as StateWithSource['metadata']).route,
        observedCount: sortedByObservations[0].observedCount,
      }
    : undefined;

  const leastVisitedState = sortedByObservations.length > 0
    ? {
        id: sortedByObservations[sortedByObservations.length - 1].id,
        name: sortedByObservations[sortedByObservations.length - 1].name,
        route: (sortedByObservations[sortedByObservations.length - 1].metadata as StateWithSource['metadata']).route,
        observedCount: sortedByObservations[sortedByObservations.length - 1].observedCount,
      }
    : undefined;

  return {
    totalAstStates,
    observedStates: observedAstStates,
    coveragePercentage,
    unreachedStates,
    unexpectedStates: unexpectedStateInfos,
    unexpectedFlows,
    summary: {
      totalStates: spec.states.length,
      totalTransitions: spec.transitions.length,
      statesWithObservations: statesWithObservations.length,
      avgObservationsPerState,
      mostVisitedState,
      leastVisitedState,
    },
  };
}

/**
 * Format coverage info as a readable report
 */
export function formatCoverageReport(coverage: CoverageInfo): string {
  const lines: string[] = [];

  lines.push('=== Coverage Report ===\n');

  // Overview
  lines.push(`Coverage: ${coverage.coveragePercentage}% (${coverage.observedStates}/${coverage.totalAstStates} states)`);
  lines.push(`Total States: ${coverage.summary.totalStates} (${coverage.totalAstStates} from AST, ${coverage.unexpectedStates.length} unexpected)`);
  lines.push(`Total Transitions: ${coverage.summary.totalTransitions}`);
  lines.push(`Avg Observations per State: ${coverage.summary.avgObservationsPerState}\n`);

  // Most/least visited
  if (coverage.summary.mostVisitedState) {
    lines.push(`Most Visited: ${coverage.summary.mostVisitedState.name} (${coverage.summary.mostVisitedState.observedCount} times)`);
  }
  if (coverage.summary.leastVisitedState) {
    lines.push(`Least Visited: ${coverage.summary.leastVisitedState.name} (${coverage.summary.leastVisitedState.observedCount} times)\n`);
  }

  // Unreached states
  if (coverage.unreachedStates.length > 0) {
    lines.push(`\n⚠️  Unreached States (${coverage.unreachedStates.length}):`);
    for (const state of coverage.unreachedStates) {
      const route = state.route ? ` [${state.route}]` : '';
      lines.push(`  - ${state.name}${route}`);
    }
  } else {
    lines.push('\n✓ All AST states were reached!');
  }

  // Unexpected states
  if (coverage.unexpectedStates.length > 0) {
    lines.push(`\n⚠️  Unexpected States (${coverage.unexpectedStates.length}):`);
    for (const state of coverage.unexpectedStates) {
      lines.push(`  - ${state.name} (observed ${state.observedCount} times)`);
    }
  }

  // Unexpected flows
  if (coverage.unexpectedFlows.length > 0) {
    lines.push(`\n⚠️  Unexpected Flows (${coverage.unexpectedFlows.length}):`);
    for (const flow of coverage.unexpectedFlows.slice(0, 10)) {
      lines.push(`  - ${flow.from} → ${flow.to} (${flow.frequency}x)`);
    }
    if (coverage.unexpectedFlows.length > 10) {
      lines.push(`  ... and ${coverage.unexpectedFlows.length - 10} more`);
    }
  }

  return lines.join('\n');
}
