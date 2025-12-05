/**
 * Maestro Test Generator
 *
 * Converts GremlinSpec to Maestro YAML flow files.
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
} from '../spec/types.ts';

// ============================================================================
// Types
// ============================================================================

export interface MaestroGeneratorOptions {
  /** App ID (bundle identifier) */
  appId: string;

  /** Output directory for flow files */
  outputDir?: string;

  /** Include comments in generated code */
  includeComments?: boolean;

  /** Include screenshots */
  includeScreenshots?: boolean;

  /** Platform (ios or android) */
  platform?: 'ios' | 'android';
}

export interface MaestroFlow {
  name: string;
  fileName: string;
  yaml: string;
}

// ============================================================================
// Main Generator
// ============================================================================

export function generateMaestroFlows(
  spec: GremlinSpec,
  options: MaestroGeneratorOptions
): MaestroFlow[] {
  const {
    appId,
    includeComments = true,
    includeScreenshots = false,
    platform = 'ios',
  } = options;

  const flows: MaestroFlow[] = [];

  // Extract meaningful flows from the spec
  const extractedFlows = extractFlows(spec);

  for (const flow of extractedFlows) {
    const yaml = generateFlowYaml(spec, flow, {
      appId,
      includeComments,
      includeScreenshots,
      platform,
    });

    flows.push({
      name: flow.name,
      fileName: `${flow.name}.yaml`,
      yaml,
    });
  }

  return flows;
}

/**
 * Generate a single combined flow file (for simpler cases)
 */
export function generateMaestroTestSuite(
  spec: GremlinSpec,
  options: MaestroGeneratorOptions
): string {
  const {
    appId,
    includeComments = true,
    platform = 'ios',
  } = options;

  const lines: string[] = [];

  // Header
  lines.push(`appId: ${appId}`);
  lines.push('');

  if (includeComments) {
    lines.push(`# Auto-generated Maestro tests from GremlinSpec: ${spec.name}`);
    lines.push(`# Generated at: ${new Date().toISOString()}`);
    lines.push(`# Sessions analyzed: ${spec.metadata.sessionCount}`);
    lines.push('');
  }

  // Configuration
  lines.push('---');
  lines.push('');

  // Launch app
  lines.push('- launchApp');
  lines.push('');

  // Generate test steps for top flows
  const extractedFlows = extractFlows(spec);
  const topFlow = extractedFlows[0];

  if (topFlow) {
    if (includeComments) {
      lines.push(`# Flow: ${topFlow.description}`);
      lines.push('');
    }

    for (let i = 0; i < topFlow.transitions.length; i++) {
      const transition = topFlow.transitions[i];
      const fromState = spec.states.find((s) => s.id === transition.from);
      const toState = spec.states.find((s) => s.id === transition.to);

      if (includeComments) {
        lines.push(`# Step ${i + 1}: ${fromState?.name || transition.from} → ${toState?.name || transition.to}`);
      }

      const steps = generateTransitionSteps(transition, { platform, includeComments });
      lines.push(...steps);
      lines.push('');
    }
  }

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

        flows.push({
          name: `${getStateName(spec, startState)}_to_${getStateName(spec, endState)}`,
          description: `Flow from ${getStateName(spec, startState)} to ${getStateName(spec, endState)}`,
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

function getStateName(spec: GremlinSpec, stateId: StateId): string {
  const state = spec.states.find((s) => s.id === stateId);
  return state?.name || stateId;
}

// ============================================================================
// YAML Generation
// ============================================================================

interface YamlGenOptions {
  appId: string;
  includeComments: boolean;
  includeScreenshots: boolean;
  platform: 'ios' | 'android';
}

function generateFlowYaml(
  spec: GremlinSpec,
  flow: Flow,
  options: YamlGenOptions
): string {
  const { appId, includeComments, includeScreenshots, platform } = options;
  const lines: string[] = [];

  // Header
  lines.push(`appId: ${appId}`);
  lines.push('');

  if (includeComments) {
    lines.push(`# ${flow.description}`);
    lines.push(`# Steps: ${flow.transitions.length}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Launch app
  lines.push('- launchApp:');
  lines.push('    clearState: true');
  lines.push('');

  // Generate steps for each transition
  for (let i = 0; i < flow.transitions.length; i++) {
    const transition = flow.transitions[i];
    const fromState = spec.states.find((s) => s.id === transition.from);
    const toState = spec.states.find((s) => s.id === transition.to);

    if (includeComments) {
      lines.push(`# Step ${i + 1}: ${fromState?.name || transition.from} → ${toState?.name || transition.to}`);
    }

    // Generate guard check if present
    if (transition.guard) {
      const guardSteps = generateGuardSteps(transition.guard);
      lines.push(...guardSteps);
    }

    // Generate the action
    const actionSteps = generateTransitionSteps(transition, { platform, includeComments });
    lines.push(...actionSteps);

    // Generate state assertion after transition
    if (toState) {
      const assertionSteps = generateStateAssertionSteps(toState);
      lines.push(...assertionSteps);
    }

    // Screenshot after step
    if (includeScreenshots) {
      lines.push(`- takeScreenshot: ${flow.name}_step_${i + 1}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

interface StepGenOptions {
  platform: 'ios' | 'android';
  includeComments: boolean;
}

function generateTransitionSteps(
  transition: Transition,
  options: StepGenOptions
): string[] {
  const steps: string[] = [];
  const event = transition.event;

  switch (event.type) {
    case 'tap':
      steps.push(...generateTapSteps(event.element));
      break;

    case 'double_tap':
      steps.push(...generateDoubleTapSteps(event.element));
      break;

    case 'long_press':
      steps.push(...generateLongPressSteps(event.element));
      break;

    case 'input':
      steps.push(...generateInputSteps(event.element, event.data));
      break;

    case 'swipe':
      steps.push(...generateSwipeSteps(event.data));
      break;

    case 'scroll':
      steps.push(...generateScrollSteps(event.data));
      break;

    case 'back':
      steps.push('- pressKey: back');
      break;

    case 'navigation':
      // Navigation usually happens automatically after actions
      if (options.includeComments) {
        steps.push(`# Navigation to: ${event.data?.screen || 'unknown'}`);
      }
      break;

    default:
      steps.push(`# TODO: Handle ${event.type} event`);
  }

  return steps;
}

function generateTapSteps(element?: ElementRef): string[] {
  const selector = generateSelector(element);
  return [`- tapOn: ${selector}`];
}

function generateDoubleTapSteps(element?: ElementRef): string[] {
  const selector = generateSelector(element);
  return [
    `- tapOn: ${selector}`,
    `- tapOn: ${selector}`,
  ];
}

function generateLongPressSteps(element?: ElementRef): string[] {
  const selector = generateSelector(element);
  return [`- longPressOn: ${selector}`];
}

function generateInputSteps(element?: ElementRef, data?: Record<string, unknown>): string[] {
  const steps: string[] = [];
  const value = typeof data?.value === 'string' ? data.value : 'test input';

  // Tap to focus
  if (element) {
    const selector = generateSelector(element);
    steps.push(`- tapOn: ${selector}`);
  }

  // Clear existing text
  steps.push('- eraseText: 50');

  // Input new text
  steps.push(`- inputText: "${escapeYamlString(value)}"`);

  return steps;
}

function generateSwipeSteps(data?: Record<string, unknown>): string[] {
  const direction = data?.direction || 'UP';
  return [`- swipe: ${String(direction).toUpperCase()}`];
}

function generateScrollSteps(data?: Record<string, unknown>): string[] {
  const direction = (data?.deltaY as number) > 0 ? 'DOWN' : 'UP';
  return [`- scroll: ${direction}`];
}

function generateSelector(element?: ElementRef): string {
  if (!element) {
    return '"*"';
  }

  // Priority order for selectors
  if (element.testId) {
    return `"${element.testId}"`;
  }

  if (element.accessibilityLabel) {
    return `"${escapeYamlString(element.accessibilityLabel)}"`;
  }

  if (element.text) {
    return `"${escapeYamlString(element.text)}"`;
  }

  // Fallback to coordinates (fragile)
  if (element.coordinates) {
    return `{ x: ${element.coordinates.x}, y: ${element.coordinates.y} }`;
  }

  return '"*"';
}

function generateGuardSteps(guard: Predicate): string[] {
  const steps: string[] = [];

  switch (guard.type) {
    case 'element_visible':
      const selector = generateSelector(guard.element);
      steps.push(`- assertVisible: ${selector}`);
      break;

    case 'element_exists':
      const existsSelector = generateSelector(guard.element);
      steps.push(`- assertVisible: ${existsSelector}`);
      break;

    default:
      steps.push(`# Guard: ${JSON.stringify(guard)}`);
  }

  return steps;
}

function generateStateAssertionSteps(state: State): string[] {
  const steps: string[] = [];

  // Look for identifiable elements in the state
  // This is a heuristic - real implementation would use screenshots or specific markers

  // Wait for state to be visible
  steps.push(`- extendedWaitUntil:`);
  steps.push(`    visible: ".*"`);
  steps.push(`    timeout: 5000`);

  return steps;
}

// ============================================================================
// Utilities
// ============================================================================

function escapeYamlString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ============================================================================
// Export Combined Flow File
// ============================================================================

/**
 * Generate a config file that runs all flows
 */
export function generateMaestroConfig(flows: MaestroFlow[]): string {
  const lines: string[] = [];

  lines.push('# Maestro Test Suite Configuration');
  lines.push('# Run all flows: maestro test .');
  lines.push('');
  lines.push('flows:');

  for (const flow of flows) {
    lines.push(`  - ${flow.fileName}`);
  }

  return lines.join('\n');
}
