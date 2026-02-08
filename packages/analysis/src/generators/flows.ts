/**
 * Shared flow extraction logic used by Playwright and Maestro generators.
 *
 * Extracts user flows (paths through the state machine) from a GremlinSpec
 * using DFS from the initial state to terminal states.
 */

import type {
  GremlinSpec,
  Transition,
  StateId,
} from '../spec/types';

export interface Flow {
  name: string;
  description: string;
  transitions: Transition[];
  startState: StateId;
  endState: StateId;
}

export function getStateName(spec: GremlinSpec, stateId: StateId): string {
  const state = spec.states.find((s) => s.id === stateId);
  return state?.name || stateId;
}

export function extractFlows(spec: GremlinSpec): Flow[] {
  const flows: Flow[] = [];

  // Find terminal states (no outgoing transitions)
  const statesWithOutgoing = new Set<StateId>();
  for (const transition of spec.transitions) {
    statesWithOutgoing.add(transition.from);
  }

  const terminalStates = new Set<StateId>();
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

    if (terminalStates.has(currentState) && path.length > 0) {
      const pathKey = path.map((t) => t.id).join('->');
      if (!visited.has(pathKey)) {
        visited.add(pathKey);

        const startState = path[0].from;
        const endState = path[path.length - 1].to;

        // Generate descriptive name including key events
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
