/**
 * Flow Analyzer
 *
 * Uses AI to extract GremlinSpec from recorded sessions.
 * This is the core AI-powered analysis that converts raw user behavior
 * into a formal state machine specification.
 */

import { z } from 'zod';
import { type GremlinSession, SCHEMA_VERSION } from '@gremlin/session';
import type {
  GremlinSpec,
  State,
  Transition,
  Variable,
  Property,
  VariableId,
  PropertyId,
  TransitionEvent,
  Predicate,
  PropertyType,
  VariableType,
} from '../spec/types.ts';
import { stateId, transitionId } from '../spec/types.ts';
import { formatSessionsForPrompt, formatEvent, parseJsonResponse } from './session-formatter.ts';
import { callAIProvider } from './providers.ts';

export { formatSessionsForPrompt, formatEvent } from './session-formatter.ts';

// ============================================================================
// Zod Schemas for AI Response Validation
// ============================================================================

const ExtractedStateSchema = z.object({
  id: z.string().min(1, 'State id cannot be empty'),
  name: z.string().min(1, 'State name cannot be empty'),
  description: z.string(),
  isTerminal: z.boolean(),
});

const ExtractedTransitionSchema = z.object({
  id: z.string().min(1, 'Transition id cannot be empty'),
  from: z.string().min(1, 'Transition from cannot be empty'),
  to: z.string().min(1, 'Transition to cannot be empty'),
  event: z.string().min(1, 'Transition event cannot be empty'),
  guard: z.string().optional(),
  frequency: z.number().int().min(0),
});

const ExtractedVariableSchema = z.object({
  name: z.string().min(1, 'Variable name cannot be empty'),
  type: z.enum(['boolean', 'number', 'string']),
  description: z.string(),
});

const ExtractedPropertySchema = z.object({
  name: z.string().min(1, 'Property name cannot be empty'),
  description: z.string(),
  type: z.enum(['invariant', 'never', 'eventually', 'leads_to']),
});

const ExtractedSpecSchema = z.object({
  states: z.array(ExtractedStateSchema).min(1, 'Must have at least one state'),
  transitions: z.array(ExtractedTransitionSchema),
  initialState: z.string().min(1, 'Initial state cannot be empty'),
  variables: z.array(ExtractedVariableSchema),
  properties: z.array(ExtractedPropertySchema),
  insights: z.array(z.string()),
}).refine(
  (data) => data.states.some(s => s.id === data.initialState),
  { message: 'initialState must reference an existing state id' }
).refine(
  (data) => {
    const stateIds = new Set(data.states.map(s => s.id));
    return data.transitions.every(t => stateIds.has(t.from) && stateIds.has(t.to));
  },
  { message: 'All transition from/to must reference existing state ids' }
);

// ============================================================================
// Types
// ============================================================================

export interface FlowAnalyzerOptions {
  /** AI provider to use */
  provider: 'anthropic' | 'openai' | 'gemini';

  /** API key for the provider */
  apiKey: string;

  /** Model to use */
  model?: string;

  /** App name for the generated spec */
  appName: string;

  /** Platform */
  platform: 'web' | 'ios' | 'android' | 'cross-platform';

  /** Maximum retry attempts for validation failures (default: 3) */
  maxRetries?: number;

  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

export interface ValidationError {
  path: string[];
  message: string;
}

export interface ExtractedSpec {
  states: Array<{
    id: string;
    name: string;
    description: string;
    isTerminal: boolean;
  }>;
  transitions: Array<{
    id: string;
    from: string;
    to: string;
    event: string;
    guard?: string;
    frequency: number;
  }>;
  initialState: string;
  variables: Array<{
    name: string;
    type: 'boolean' | 'number' | 'string';
    description: string;
  }>;
  properties: Array<{
    name: string;
    description: string;
    type: 'invariant' | 'never' | 'eventually' | 'leads_to';
  }>;
  insights: string[];
}

// ============================================================================
// Main Analyzer
// ============================================================================

/**
 * Analyze sessions and extract a GremlinSpec using AI.
 * Includes Zod schema validation with automatic retry on validation failures.
 */
export async function analyzeFlows(
  sessions: GremlinSession[],
  options: FlowAnalyzerOptions
): Promise<GremlinSpec> {
  const { provider, apiKey, model, appName, platform, maxRetries = 3, onProgress } = options;

  // Format sessions for the prompt
  const sessionsPrompt = formatSessionsForPrompt(sessions);

  // Build the extraction prompt
  let prompt = buildExtractionPrompt(sessionsPrompt);

  let lastError: Error | null = null;
  let lastValidationErrors: ValidationError[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    onProgress?.(`AI extraction attempt ${attempt}/${maxRetries}...`);

    try {
      // Call AI provider
      const rawResponse = await callAIProvider(provider, apiKey, prompt, { model });

      // Parse JSON
      const parsed = parseJsonResponse(rawResponse);

      // Validate with Zod
      const validated = validateExtractedSpec(parsed);

      onProgress?.('Validation passed, converting to GremlinSpec...');

      // Convert extracted data to GremlinSpec
      const spec = convertToGremlinSpec(validated, appName, platform, sessions.length);

      return spec;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's a validation error, build a retry prompt with the errors
      if (error instanceof AIValidationError) {
        lastValidationErrors = error.errors;
        onProgress?.(`Validation failed (attempt ${attempt}): ${error.errors.map(e => e.message).join(', ')}`);

        // Build retry prompt with validation errors
        prompt = buildRetryPrompt(sessionsPrompt, error.errors, error.rawResponse);
      } else {
        onProgress?.(`Error (attempt ${attempt}): ${lastError.message}`);
        // For non-validation errors, throw immediately
        throw lastError;
      }
    }
  }

  // All retries exhausted
  throw new AIExtractionError(
    `Failed to extract valid spec after ${maxRetries} attempts`,
    lastValidationErrors,
    lastError
  );
}

/**
 * Custom error for validation failures with structured error info
 */
export class AIValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
    public readonly rawResponse: string
  ) {
    super(message);
    this.name = 'AIValidationError';
  }
}

/**
 * Custom error for extraction failures after all retries
 */
export class AIExtractionError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ValidationError[],
    public readonly lastError: Error | null
  ) {
    super(message);
    this.name = 'AIExtractionError';
  }
}

/**
 * Validate extracted spec with Zod schema
 */
function validateExtractedSpec(data: unknown): ExtractedSpec {
  const result = ExtractedSpecSchema.safeParse(data);

  if (!result.success) {
    const errors: ValidationError[] = result.error.issues.map(issue => ({
      path: issue.path.map(String),
      message: issue.message,
    }));

    throw new AIValidationError(
      `AI response validation failed: ${errors.map(e => e.message).join('; ')}`,
      errors,
      JSON.stringify(data, null, 2)
    );
  }

  return result.data;
}

/**
 * Build a retry prompt that includes the validation errors
 */
function buildRetryPrompt(sessionsData: string, errors: ValidationError[], previousResponse: string): string {
  const errorList = errors.map(e => `- ${e.path.join('.')}: ${e.message}`).join('\n');

  const retryCorrectionSection = `## IMPORTANT: Your previous response had validation errors

Your previous response:
\`\`\`json
${previousResponse}
\`\`\`

Validation errors found:
${errorList}

Please fix these issues and provide a corrected response.

`;

  return [
    buildPreambleSection(sessionsData),
    retryCorrectionSection,
    buildTaskSection(),
    buildOutputSchemaSection(),
    'CRITICAL: Ensure all id references are valid. initialState and all transition from/to values MUST match existing state ids.\n\nOutput ONLY the JSON, no other text.',
  ].join('');
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildExtractionPrompt(sessionsData: string): string {
  return [
    buildPreambleSection(sessionsData),
    buildTaskSection(),
    buildOutputSchemaSection(),
    'Be thorough but avoid over-fitting to the exact sessions. The goal is to capture the general behavior model that would work for similar sessions.\n\nOutput ONLY the JSON, no other text.',
  ].join('');
}

/** Shared preamble: role description + sessions data. */
function buildPreambleSection(sessionsData: string): string {
  return `You are an expert at analyzing user behavior data to infer application state machines.

Given the following user session recordings, analyze the data and extract a formal state machine specification.

## Sessions Data

${sessionsData}

`;
}

/** Shared task description: what to extract from the sessions. */
function buildTaskSection(): string {
  return `## Your Task

Analyze these user sessions and produce a state machine specification with:

1. **States**: Identify all meaningful application states. Don't just list screens - identify the semantic state (e.g., "cart_empty" vs "cart_with_items" vs "checkout_ready")

2. **Transitions**: Identify all transitions between states, including:
   - The trigger event (tap, input, navigation)
   - The source and destination states
   - Any guards/conditions (e.g., "cart must have items")

3. **Initial State**: What state does the app start in? MUST be one of the state IDs.

4. **Variables**: What variables track state? (e.g., isLoggedIn, cartItemCount, hasPaymentMethod)

5. **Properties**: What invariants should hold? Express as natural language, e.g.:
   - "Cannot reach OrderConfirmation without going through Checkout"
   - "Cannot checkout with empty cart"

`;
}

/** Shared output schema: the TypeScript interface the AI must produce. */
function buildOutputSchemaSection(): string {
  return `## Output Format

Respond with a JSON object matching this TypeScript interface:

\`\`\`typescript
interface ExtractedSpec {
  states: Array<{
    id: string;        // NON-EMPTY unique identifier
    name: string;      // NON-EMPTY display name
    description: string;
    isTerminal: boolean;
  }>;

  transitions: Array<{
    id: string;        // NON-EMPTY unique identifier
    from: string;      // MUST match a state id
    to: string;        // MUST match a state id
    event: string;     // NON-EMPTY, e.g., "tap:checkout-btn"
    guard?: string;    // optional natural language condition
    frequency: number; // integer >= 0, how many sessions had this transition
  }>;

  initialState: string;  // MUST match one of the state ids

  variables: Array<{
    name: string;      // NON-EMPTY
    type: "boolean" | "number" | "string";
    description: string;
  }>;

  properties: Array<{
    name: string;      // NON-EMPTY
    description: string;
    type: "invariant" | "never" | "eventually" | "leads_to";
  }>;

  insights: string[];  // Any interesting patterns you noticed
}
\`\`\`

`;
}

// ============================================================================
// Conversion to GremlinSpec
// ============================================================================

function convertToGremlinSpec(
  extracted: ExtractedSpec,
  appName: string,
  platform: 'web' | 'ios' | 'android' | 'cross-platform',
  sessionCount: number
): GremlinSpec {
  const now = new Date().toISOString();

  // Convert states
  const states: State[] = extracted.states.map((s) => ({
    id: stateId(s.id),
    name: s.name,
    description: s.description,
    invariants: [],
    observedCount: 0,
    source: 'session' as const,
  }));

  // Convert transitions
  const transitions: Transition[] = extracted.transitions.map((t, i) => ({
    id: transitionId(`t${i}`),
    from: stateId(t.from),
    to: stateId(t.to),
    event: parseEvent(t.event),
    guard: t.guard ? parseGuard(t.guard) : undefined,
    frequency: t.frequency,
    source: 'session' as const,
  }));

  // Convert variables
  const variables: Variable[] = extracted.variables.map((v, i) => ({
    id: `var_${i}` as VariableId,
    name: v.name,
    type: v.type as VariableType,
    initialValue: getDefaultValue(v.type),
    description: v.description,
  }));

  // Convert properties
  const properties: Property[] = extracted.properties.map((p, i) => ({
    id: `prop_${i}` as PropertyId,
    name: p.name,
    naturalLanguage: p.description,
    type: p.type as PropertyType,
    predicate: { type: 'literal', value: true },
  }));

  return {
    name: appName,
    schemaVersion: SCHEMA_VERSION,
    variables,
    states,
    initialState: stateId(extracted.initialState),
    transitions,
    properties,
    cycles: [],
    coverage: {
      statesFromAst: 0,
      statesObserved: states.length,
      coveragePercent: 0,
      unreachedStates: [],
      unexpectedFlows: [],
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      sessionCount,
      platform,
      appVersions: [],
    },
  };
}

function parseEvent(eventStr: string): TransitionEvent {
  // Parse event strings like "tap:checkout-btn", "input:email-field", "navigation:home"
  // Split on first colon only so targets like "tap:checkout:btn" keep "checkout:btn"
  const colonIdx = eventStr.indexOf(':');
  const type = colonIdx >= 0 ? eventStr.slice(0, colonIdx) : eventStr;
  const target = colonIdx >= 0 ? eventStr.slice(colonIdx + 1) : undefined;

  const eventType = type as TransitionEvent['type'];

  return {
    type: eventType || 'tap',
    element: target ? { testId: target } : undefined,
  };
}

function parseGuard(guardStr: string): Predicate {
  const lower = guardStr.toLowerCase().trim();

  // Pattern: "element X is visible" / "X is visible" / "X visible"
  const visibleMatch = lower.match(/(?:element\s+)?['""]?(.+?)['""]?\s+(?:is\s+)?visible/);
  if (visibleMatch) {
    return { type: 'element_visible', element: { testId: visibleMatch[1].trim() } };
  }

  // Pattern: "element X exists" / "X exists"
  const existsMatch = lower.match(/(?:element\s+)?['""]?(.+?)['""]?\s+exists/);
  if (existsMatch) {
    return { type: 'element_exists', element: { testId: existsMatch[1].trim() } };
  }

  // Pattern: "variable == value" / "variable != value" / "variable > value"
  const compMatch = guardStr.match(/^(.+?)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/);
  if (compMatch) {
    const [, leftStr, op, rightStr] = compMatch;
    return {
      type: 'comparison',
      left: { type: 'variable', name: leftStr.trim() },
      op: op as any,
      right: { type: 'literal', value: rightStr.trim() },
    };
  }

  // Pattern: "not X" / "!X"
  const notMatch = lower.match(/^(?:not\s+|!)(.+)$/);
  if (notMatch) {
    return { type: 'not', operand: parseGuard(notMatch[1]) };
  }

  // Fallback: store as a comparison with the description so it appears as a
  // comment in generated code rather than being silently dropped
  return {
    type: 'comparison',
    left: { type: 'variable', name: 'guard' },
    op: '==',
    right: { type: 'literal', value: guardStr },
  };
}

function getDefaultValue(type: string): unknown {
  switch (type) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
    default:
      return null;
  }
}

// Types are exported at declaration above
