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

  /** How many times this transition was observed */
  frequency: number;

  /** Average time for this transition to complete (ms) */
  avgDuration?: number;
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
    metadata: {
      createdAt: now,
      updatedAt: now,
      sessionCount: 0,
      platform,
      appVersions: [],
    },
  };
}

export function createState(id: string, name: string): State {
  return {
    id: stateId(id),
    name,
    invariants: [],
    observedCount: 0,
  };
}

export function createTransition(
  id: string,
  from: StateId,
  to: StateId,
  event: TransitionEvent
): Transition {
  return {
    id: transitionId(id),
    from,
    to,
    event,
    frequency: 0,
  };
}
