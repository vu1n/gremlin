/**
 * Flow Analyzer
 *
 * Uses AI to extract GremlinSpec from recorded sessions.
 * This is the core AI-powered analysis that converts raw user behavior
 * into a formal state machine specification.
 */

import type { GremlinSession } from '../session/types';
import type {
  GremlinSpec,
  State,
  Transition,
  Variable,
  Property,
  StateId,
  TransitionId,
  VariableId,
  PropertyId,
  TransitionEvent,
  Predicate,
  PropertyType,
  VariableType,
} from '../spec/types';
import { stateId, transitionId } from '../spec/types';

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
 */
export async function analyzeFlows(
  sessions: GremlinSession[],
  options: FlowAnalyzerOptions
): Promise<GremlinSpec> {
  const { provider, apiKey, model, appName, platform } = options;

  // Format sessions for the prompt
  const sessionsPrompt = formatSessionsForPrompt(sessions);

  // Build the extraction prompt
  const prompt = buildExtractionPrompt(sessionsPrompt);

  // Call AI provider
  const extracted = await callAIProvider(provider, apiKey, model, prompt);

  // Convert extracted data to GremlinSpec
  const spec = convertToGremlinSpec(extracted, appName, platform, sessions.length);

  return spec;
}

// ============================================================================
// Session Formatting
// ============================================================================

function formatSessionsForPrompt(sessions: GremlinSession[]): string {
  const lines: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    lines.push(`### Session ${i + 1}`);
    lines.push(`Device: ${session.header.device.platform} ${session.header.device.osVersion}`);
    lines.push(`App: ${session.header.app.name} v${session.header.app.version}`);
    lines.push('');
    lines.push('Events:');

    let timestamp = 0;
    for (const event of session.events) {
      timestamp += event.dt;
      const eventStr = formatEvent(session, event, timestamp);
      lines.push(`  ${eventStr}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function formatEvent(
  session: GremlinSession,
  event: GremlinSession['events'][0],
  timestamp: number
): string {
  const timeStr = `[${(timestamp / 1000).toFixed(1)}s]`;
  const data = event.data;

  if ('kind' in data) {
    switch (data.kind) {
      case 'tap':
      case 'double_tap':
      case 'long_press': {
        const element = data.elementIndex !== undefined
          ? session.elements[data.elementIndex]
          : null;
        const elementStr = element
          ? `${element.testId || element.accessibilityLabel || element.text || 'unknown'} (${element.type})`
          : `(${data.x}, ${data.y})`;
        return `${timeStr} ${data.kind.toUpperCase()}: ${elementStr}`;
      }

      case 'swipe':
        return `${timeStr} SWIPE: ${data.direction} (${data.duration}ms)`;

      case 'scroll':
        return `${timeStr} SCROLL: deltaY=${data.deltaY}`;

      case 'input': {
        const inputElement = data.elementIndex !== undefined
          ? session.elements[data.elementIndex]
          : null;
        const inputTarget = inputElement?.testId || inputElement?.accessibilityLabel || 'unknown';
        return `${timeStr} INPUT: ${inputTarget} = "${data.masked ? '***' : data.value}"`;
      }

      case 'navigation':
        return `${timeStr} NAVIGATE: ${data.navType} → ${data.screen}`;

      case 'network':
        return `${timeStr} NETWORK: ${data.method} ${data.url} (${data.phase})`;

      case 'error':
        return `${timeStr} ERROR: ${data.message}`;

      case 'app_state':
        return `${timeStr} APP_STATE: ${data.state}`;

      default:
        return `${timeStr} UNKNOWN: ${JSON.stringify(data)}`;
    }
  }

  return `${timeStr} EVENT: ${JSON.stringify(data)}`;
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildExtractionPrompt(sessionsData: string): string {
  return `You are an expert at analyzing user behavior data to infer application state machines.

Given the following user session recordings, analyze the data and extract a formal state machine specification.

## Sessions Data

${sessionsData}

## Your Task

Analyze these user sessions and produce a state machine specification with:

1. **States**: Identify all meaningful application states. Don't just list screens - identify the semantic state (e.g., "cart_empty" vs "cart_with_items" vs "checkout_ready")

2. **Transitions**: Identify all transitions between states, including:
   - The trigger event (tap, input, navigation)
   - The source and destination states
   - Any guards/conditions (e.g., "cart must have items")

3. **Initial State**: What state does the app start in?

4. **Variables**: What variables track state? (e.g., isLoggedIn, cartItemCount, hasPaymentMethod)

5. **Properties**: What invariants should hold? Express as natural language, e.g.:
   - "Cannot reach OrderConfirmation without going through Checkout"
   - "Cannot checkout with empty cart"

## Output Format

Respond with a JSON object matching this TypeScript interface:

\`\`\`typescript
interface ExtractedSpec {
  states: Array<{
    id: string;
    name: string;
    description: string;
    isTerminal: boolean;
  }>;

  transitions: Array<{
    id: string;
    from: string;  // state id
    to: string;    // state id
    event: string; // e.g., "tap:checkout-btn"
    guard?: string; // natural language condition
    frequency: number; // how many sessions had this transition
  }>;

  initialState: string;

  variables: Array<{
    name: string;
    type: "boolean" | "number" | "string";
    description: string;
  }>;

  properties: Array<{
    name: string;
    description: string;
    type: "invariant" | "never" | "eventually" | "leads_to";
  }>;

  insights: string[]; // Any interesting patterns you noticed
}
\`\`\`

Be thorough but avoid over-fitting to the exact sessions. The goal is to capture the general behavior model that would work for similar sessions.

Output ONLY the JSON, no other text.`;
}

// ============================================================================
// AI Provider Calls
// ============================================================================

async function callAIProvider(
  provider: 'anthropic' | 'openai' | 'gemini',
  apiKey: string,
  model: string | undefined,
  prompt: string
): Promise<ExtractedSpec> {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(apiKey, model || 'claude-sonnet-4-20250514', prompt);
    case 'openai':
      return callOpenAI(apiKey, model || 'gpt-4o', prompt);
    case 'gemini':
      return callGemini(apiKey, model || 'gemini-2.0-flash', prompt);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string
): Promise<ExtractedSpec> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;

  if (!content) {
    throw new Error('No content in Anthropic response');
  }

  return parseAIResponse(content);
}

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string
): Promise<ExtractedSpec> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  return parseAIResponse(content);
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string
): Promise<ExtractedSpec> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('No content in Gemini response');
  }

  return parseAIResponse(content);
}

function parseAIResponse(rawOutput: string): ExtractedSpec {
  // Handle potential markdown code blocks
  const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawOutput.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON: ${e}`);
  }
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
  }));

  // Convert transitions
  const transitions: Transition[] = extracted.transitions.map((t, i) => ({
    id: transitionId(`t${i}`),
    from: stateId(t.from),
    to: stateId(t.to),
    event: parseEvent(t.event),
    guard: t.guard ? parseGuard(t.guard) : undefined,
    frequency: t.frequency,
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
    schemaVersion: 1,
    variables,
    states,
    initialState: stateId(extracted.initialState),
    transitions,
    properties,
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
  const [type, target] = eventStr.split(':');

  const eventType = type as TransitionEvent['type'];

  return {
    type: eventType || 'tap',
    element: target ? { testId: target } : undefined,
  };
}

function parseGuard(guardStr: string): Predicate {
  // For now, store as a description - could parse to formal predicate later
  return {
    type: 'literal',
    value: true,
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
