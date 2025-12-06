/**
 * GremlinSpec - TLA+-compatible state machine model
 *
 * This is the core foundation that everything builds on.
 * Must be serializable to: TLA+, Playwright, Maestro, XState
 */

// ============================================================================
// Identifiers
// ============================================================================

export type StateId = string & { readonly __brand: 'StateId' };
export type TransitionId = string & { readonly __brand: 'TransitionId' };
export type VariableId = string & { readonly __brand: 'VariableId' };
export type PropertyId = string & { readonly __brand: 'PropertyId' };

export function stateId(id: string): StateId {
  return id as StateId;
}

export function transitionId(id: string): TransitionId {
  return id as TransitionId;
}

// ============================================================================
// Core Spec Types
// ============================================================================

/**
 * The main state machine specification.
 * Represents the inferred behavior model of an application.
 */
export interface GremlinSpec {
  /** Unique name for this spec */
  name: string;

  /** Schema version for migrations */
  schemaVersion: number;

  /** Variables that can change during execution */
  variables: Variable[];

  /** All possible states */
  states: State[];

  /** Initial state when app starts */
  initialState: StateId;

  /** Transitions between states */
  transitions: Transition[];

  /** Properties to verify (for TLA+ model checking) */
  properties: Property[];

  /** Detected cycles in the state machine with iteration bounds */
  cycles: CycleInfo[];

  /** Coverage information comparing AST-discovered vs session-observed states */
  coverage: CoverageInfo;

  /** Metadata about the spec */
  metadata: SpecMetadata;
}

export interface SpecMetadata {
  /** When this spec was created */
  createdAt: string;

  /** When this spec was last updated */
  updatedAt: string;

  /** Number of sessions used to infer this spec */
  sessionCount: number;

  /** Platform this spec is for */
  platform: 'web' | 'ios' | 'android' | 'cross-platform';

  /** App version(s) this spec represents */
  appVersions: string[];
}

// ============================================================================
// State
// ============================================================================

/**
 * A state in the application's behavior model.
 * Typically corresponds to a screen or significant UI state.
 */
export interface State {
  /** Unique identifier */
  id: StateId;

  /** Human-readable name (e.g., "checkout_page", "login_modal") */
  name: string;

  /** Description of this state */
  description?: string;

  /** Conditions that must hold while in this state */
  invariants: Predicate[];

  /** Representative screenshot for this state */
  screenshot?: ScreenshotRef;

  /** How many times this state was observed */
  observedCount: number;

  /** Average time spent in this state (ms) */
  avgDuration?: number;

  /** Where this state was discovered from */
  source: 'ast' | 'session' | 'both';

  /** Additional metadata (e.g., URL, route) */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Transition
// ============================================================================

/**
 * A transition between states, triggered by a user action.
 */
export interface Transition {
  /** Unique identifier */
  id: TransitionId;

  /** Source state */
  from: StateId;

  /** Destination state */
  to: StateId;

  /** Event that triggers this transition */
  event: TransitionEvent;

  /** Condition that must be true for this transition to be valid */
  guard?: Predicate;

  /** Action performed during transition */
  action?: Action;

  /** How many times this transition was observed (0 = AST-only, not observed) */
  frequency: number;

  /** Average time for this transition to complete (ms) */
  avgDuration?: number;

  /** Where this transition was discovered from */
  source: 'ast' | 'session' | 'both';
}

/**
 * An event that triggers a transition.
 */
export interface TransitionEvent {
  /** Type of event */
  type: EventType;

  /** Target element (if applicable) */
  element?: ElementRef;

  /** Additional event data */
  data?: Record<string, unknown>;
}

export type EventType =
  | 'tap'
  | 'double_tap'
  | 'long_press'
  | 'swipe'
  | 'scroll'
  | 'input'
  | 'submit'
  | 'navigation'
  | 'back'
  | 'app_background'
  | 'app_foreground'
  | 'network_response'
  | 'timeout';

// ============================================================================
// Variables
// ============================================================================

/**
 * A variable that can change during app execution.
 * Used for guards and predicates.
 */
export interface Variable {
  /** Unique identifier */
  id: VariableId;

  /** Variable name */
  name: string;

  /** Type of the variable */
  type: VariableType;

  /** Initial value */
  initialValue: unknown;

  /** Description */
  description?: string;
}

export type VariableType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'object';

// ============================================================================
// Properties (for verification)
// ============================================================================

/**
 * A property to verify using model checking.
 * Expressed in natural language, compiled to TLA+.
 */
export interface Property {
  /** Unique identifier */
  id: PropertyId;

  /** Property name */
  name: string;

  /** Natural language description */
  naturalLanguage: string;

  /** Type of temporal property */
  type: PropertyType;

  /** Formal predicate */
  predicate: Predicate;

  /** Whether this property has been verified */
  verified?: boolean;

  /** Counterexample if verification failed */
  counterexample?: TransitionId[];
}

export type PropertyType =
  | 'invariant'    // Always true in every state
  | 'eventually'   // Eventually becomes true
  | 'always'       // Always true from some point on
  | 'never'        // Never true
  | 'leads_to';    // X leads to Y

// ============================================================================
// Cycles
// ============================================================================

/**
 * Information about a detected cycle in the state machine.
 * Cycles can indicate normal navigation patterns, state loops, or bugs.
 */
export interface CycleInfo {
  /** Path of states that form the cycle (e.g., [home, product, cart, home]) */
  path: StateId[];

  /** Type of cycle detected */
  type: 'navigation' | 'state' | 'error';

  /** How many times this cycle was observed in sessions */
  frequency: number;

  /** Average number of iterations per session */
  avgIterations: number;

  /** Maximum number of iterations observed in any session */
  maxIterations: number;

  /** Classification of the cycle's behavior */
  classification: 'normal' | 'suspicious' | 'bug';

  /** Optional description or notes about this cycle */
  description?: string;
}

// ============================================================================
// Coverage
// ============================================================================

/**
 * Coverage information comparing code (AST) analysis with observed session data.
 * The delta between "what code allows" and "what users do" reveals insights.
 */
export interface CoverageInfo {
  /** Number of states discovered from AST/code analysis */
  statesFromAst: number;

  /** Number of states observed in actual user sessions */
  statesObserved: number;

  /** Percentage of AST states that were actually observed */
  coveragePercent: number;

  /** States that exist in code but were never reached in sessions */
  unreachedStates: StateId[];

  /** Transitions observed in sessions but not found in AST (potential security issue) */
  unexpectedFlows: TransitionId[];

  /** States that exist in code but have no references (dead code candidates) */
  deadCodeCandidates?: StateId[];

  /** Optional detailed coverage metrics */
  details?: {
    /** Number of transitions from AST */
    transitionsFromAst?: number;

    /** Number of transitions observed */
    transitionsObserved?: number;

    /** Transition coverage percentage */
    transitionCoveragePercent?: number;
  };
}

// ============================================================================
// Predicates
// ============================================================================

/**
 * A predicate (boolean expression) used in guards and properties.
 * Can be compiled to TLA+ or evaluated at runtime.
 */
export type Predicate =
  | { type: 'literal'; value: boolean }
  | { type: 'variable'; name: string }
  | { type: 'comparison'; left: PredicateValue; op: ComparisonOp; right: PredicateValue }
  | { type: 'not'; operand: Predicate }
  | { type: 'and'; operands: Predicate[] }
  | { type: 'or'; operands: Predicate[] }
  | { type: 'in_state'; stateId: StateId }
  | { type: 'element_exists'; element: ElementRef }
  | { type: 'element_visible'; element: ElementRef };

export type PredicateValue =
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'variable'; name: string }
  | { type: 'field'; object: string; field: string };

export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains';

// ============================================================================
// Actions
// ============================================================================

/**
 * An action performed during a transition.
 */
export type Action =
  | { type: 'assign'; variable: string; value: PredicateValue }
  | { type: 'increment'; variable: string; by?: number }
  | { type: 'decrement'; variable: string; by?: number }
  | { type: 'push'; variable: string; value: PredicateValue }
  | { type: 'pop'; variable: string }
  | { type: 'clear'; variable: string }
  | { type: 'sequence'; actions: Action[] };

// ============================================================================
// References
// ============================================================================

/**
 * Reference to a UI element.
 */
export interface ElementRef {
  /** Test ID (preferred) */
  testId?: string;

  /** Accessibility label */
  accessibilityLabel?: string;

  /** Visible text content */
  text?: string;

  /** Element type */
  type?: ElementType;

  /** CSS selector (web only) */
  cssSelector?: string;

  /** XPath (web only) */
  xpath?: string;

  /** Coordinates (fallback, fragile) */
  coordinates?: { x: number; y: number };
}

export type ElementType =
  | 'button'
  | 'link'
  | 'input'
  | 'text'
  | 'image'
  | 'container'
  | 'list'
  | 'list_item'
  | 'modal'
  | 'unknown';

/**
 * Reference to a screenshot.
 */
export interface ScreenshotRef {
  /** URL or path to screenshot */
  url: string;

  /** Timestamp when captured */
  capturedAt: string;

  /** Image dimensions */
  width: number;
  height: number;
}

// ============================================================================
// Factory functions
// ============================================================================

export function createSpec(name: string, platform: SpecMetadata['platform']): GremlinSpec {
  const now = new Date().toISOString();
  return {
    name,
    schemaVersion: 1,
    variables: [],
    states: [],
    initialState: stateId('initial'),
    transitions: [],
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
      createdAt: now,
      updatedAt: now,
      sessionCount: 0,
      platform,
      appVersions: [],
    },
  };
}

export function createState(
  id: string,
  name: string,
  source: 'ast' | 'session' | 'both' = 'session'
): State {
  return {
    id: stateId(id),
    name,
    invariants: [],
    observedCount: 0,
    source,
  };
}

export function createTransition(
  id: string,
  from: StateId,
  to: StateId,
  event: TransitionEvent,
  source: 'ast' | 'session' | 'both' = 'session'
): Transition {
  return {
    id: transitionId(id),
    from,
    to,
    event,
    frequency: 0,
    source,
  };
}
