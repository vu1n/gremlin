/**
 * Error Pattern Extractor
 *
 * Extracts error patterns from session data by:
 * - Scanning sessions for error events
 * - Fingerprinting errors by normalized message + type
 * - Extracting the flow (user actions) leading to each error
 * - Deduplicating and ranking patterns by frequency and severity
 */

import type {
  GremlinSession,
  GremlinEvent,
  ElementInfo,
  ErrorEvent,
  NavigationEvent,
  TapEvent,
  InputEvent,
  ScrollEvent,
} from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';
import { escapeString } from './utils.ts';

// ============================================================================
// Types
// ============================================================================

export interface FlowStep {
  action: 'navigate' | 'click' | 'fill' | 'scroll' | 'wait';
  target?: string;
  value?: string;
  description: string;
}

export interface ErrorPattern {
  fingerprint: string;
  message: string;
  errorType: 'js' | 'native' | 'network' | 'render';
  fatal: boolean;
  stack?: string;
  occurrences: number;
  sessionIds: string[];
  flow: FlowStep[];
}

// ============================================================================
// Pattern Extraction
// ============================================================================

/**
 * Extract error patterns from multiple sessions.
 * Groups errors by fingerprint (normalized message + type), collects
 * the leading flow for each occurrence, and returns the patterns
 * sorted by severity (fatal first) then frequency.
 */
export function extractErrorPatterns(
  sessions: GremlinSession[]
): ErrorPattern[] {
  const patternMap = new Map<
    string,
    {
      message: string;
      errorType: ErrorEvent['errorType'];
      fatal: boolean;
      stack?: string;
      sessionIds: string[];
      flows: FlowStep[][];
    }
  >();

  for (const session of sessions) {
    const sessionId = session.header.sessionId;

    for (let i = 0; i < session.events.length; i++) {
      const event = session.events[i];
      if (event.type !== EventTypeEnum.ERROR) continue;

      const errorData = event.data as ErrorEvent;
      const fingerprint = computeFingerprint(
        errorData.message,
        errorData.errorType
      );
      const flow = extractFlowToError(session, i);

      const existing = patternMap.get(fingerprint);
      if (existing) {
        existing.sessionIds.push(sessionId);
        existing.flows.push(flow);
        if (!existing.stack && errorData.stack) {
          existing.stack = errorData.stack;
        }
        if (errorData.fatal) {
          existing.fatal = true;
        }
      } else {
        patternMap.set(fingerprint, {
          message: errorData.message,
          errorType: errorData.errorType,
          fatal: errorData.fatal,
          stack: errorData.stack,
          sessionIds: [sessionId],
          flows: [flow],
        });
      }
    }
  }

  const patterns: ErrorPattern[] = [];
  for (const [fingerprint, data] of patternMap) {
    // Pick the longest flow as the most representative
    const bestFlow = data.flows.reduce((best, current) =>
      current.length > best.length ? current : best
    );

    patterns.push({
      fingerprint,
      message: data.message,
      errorType: data.errorType,
      fatal: data.fatal,
      stack: data.stack,
      occurrences: data.sessionIds.length,
      sessionIds: [...new Set(data.sessionIds)],
      flow: bestFlow,
    });
  }

  // Sort by occurrences descending, then fatal first
  patterns.sort((a, b) => {
    if (a.fatal !== b.fatal) return a.fatal ? -1 : 1;
    return b.occurrences - a.occurrences;
  });

  return patterns;
}

// ============================================================================
// Flow Extraction
// ============================================================================

/**
 * Extract the user flow leading up to an error event.
 * Walks backwards from the error to the last navigation event (or start),
 * then collects all intermediate user actions.
 */
export function extractFlowToError(
  session: GremlinSession,
  errorIndex: number
): FlowStep[] {
  // Walk backwards from the error to find the last navigation (or start)
  let startIndex = 0;
  for (let i = errorIndex - 1; i >= 0; i--) {
    if (session.events[i].type === EventTypeEnum.NAVIGATION) {
      startIndex = i;
      break;
    }
  }

  const steps: FlowStep[] = [];

  for (let i = startIndex; i < errorIndex; i++) {
    const event = session.events[i];
    const step = eventToFlowStep(event, session.elements);
    if (step) {
      steps.push(step);
    }
  }

  return steps;
}

/**
 * Convert a single GremlinEvent to a FlowStep for replay.
 */
export function eventToFlowStep(
  event: GremlinEvent,
  elements: ElementInfo[]
): FlowStep | null {
  switch (event.type) {
    case EventTypeEnum.NAVIGATION: {
      const nav = event.data as NavigationEvent;
      return {
        action: 'navigate',
        target: nav.url || nav.screen,
        description: `Navigate to ${nav.screen}${nav.url ? ` (${nav.url})` : ''}`,
      };
    }

    case EventTypeEnum.TAP:
    case EventTypeEnum.DOUBLE_TAP: {
      const tap = event.data as TapEvent;
      const element =
        tap.elementIndex !== undefined
          ? elements[tap.elementIndex]
          : undefined;
      const locatorDesc = element
        ? describeElement(element)
        : `(${tap.x}, ${tap.y})`;
      return {
        action: 'click',
        target: resolveLocatorString(element),
        description: `Click ${locatorDesc}`,
      };
    }

    case EventTypeEnum.INPUT: {
      const input = event.data as InputEvent;
      const element =
        input.elementIndex !== undefined
          ? elements[input.elementIndex]
          : undefined;
      return {
        action: 'fill',
        target: resolveLocatorString(element),
        value: input.masked ? 'test input' : input.value,
        description: `Fill ${describeElement(element)} with "${input.masked ? '***' : input.value}"`,
      };
    }

    case EventTypeEnum.SCROLL: {
      const scroll = event.data as ScrollEvent;
      return {
        action: 'scroll',
        description: `Scroll (${scroll.deltaX}, ${scroll.deltaY})`,
        value: String(scroll.deltaY),
      };
    }

    default:
      return null;
  }
}

// ============================================================================
// Fingerprinting & Normalization
// ============================================================================

/**
 * Compute a stable fingerprint for an error based on its normalized message and type.
 */
export function computeFingerprint(message: string, errorType: string): string {
  const normalized = normalizeMessage(message);
  return `${errorType}:${normalized}`;
}

/**
 * Normalize an error message by replacing volatile parts (IDs, timestamps, etc.)
 * with placeholders, producing a stable string suitable for fingerprinting.
 */
export function normalizeMessage(message: string): string {
  return (
    message
      // Strip UUIDs
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<id>'
      )
      // Strip numeric IDs (standalone numbers)
      .replace(/\b\d{4,}\b/g, '<id>')
      // Strip timestamps (ISO format)
      .replace(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g,
        '<timestamp>'
      )
      // Strip line:column references
      .replace(/:\d+:\d+/g, ':<line>:<col>')
      // Strip hex addresses
      .replace(/0x[0-9a-f]+/gi, '<addr>')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extract the most stable portion of a normalized message for matching.
 */
export function extractMatchFragment(normalizedMessage: string): string {
  // Take up to the first placeholder or 60 chars
  const placeholderIdx = normalizedMessage.indexOf('<');
  if (placeholderIdx > 10) {
    return normalizedMessage.substring(0, placeholderIdx).trim();
  }
  // Fall back to first 60 chars
  return normalizedMessage.substring(0, 60).trim();
}

// ============================================================================
// Locator Resolution
// ============================================================================

/**
 * Resolve a Playwright locator string from an ElementInfo.
 */
export function resolveLocatorString(element?: ElementInfo): string {
  if (!element) return "page.locator('body')";

  if (element.testId) {
    return `page.locator('[data-testid="${element.testId}"]')`;
  }

  if (element.accessibilityLabel) {
    return `page.getByLabel('${escapeString(element.accessibilityLabel)}')`;
  }

  if (element.text) {
    if (element.type === 'button') {
      return `page.getByRole('button', { name: '${escapeString(element.text)}' })`;
    }
    if (element.type === 'link') {
      return `page.getByRole('link', { name: '${escapeString(element.text)}' })`;
    }
    return `page.getByText('${escapeString(element.text)}')`;
  }

  if (element.cssSelector) {
    return `page.locator('${escapeString(element.cssSelector)}')`;
  }

  return "page.locator('body')";
}

/**
 * Describe an element in human-readable form for comments.
 */
export function describeElement(element?: ElementInfo): string {
  if (!element) return 'unknown element';
  if (element.testId) return `[data-testid="${element.testId}"]`;
  if (element.accessibilityLabel) return `"${element.accessibilityLabel}"`;
  if (element.text) return `"${element.text}"`;
  if (element.cssSelector) return element.cssSelector;
  return 'unknown element';
}

/**
 * Extract a network URL from an error pattern's message or stack trace.
 */
export function extractNetworkUrl(pattern: ErrorPattern): string | null {
  // Try to extract URL from the error message (common patterns)
  const urlMatch = pattern.message.match(
    /(?:https?:\/\/[^\s"']+|\/api\/[^\s"']+)/
  );
  if (urlMatch) return urlMatch[0];

  // Check the stack trace
  if (pattern.stack) {
    const stackUrlMatch = pattern.stack.match(
      /(?:https?:\/\/[^\s"')]+|\/api\/[^\s"')]+)/
    );
    if (stackUrlMatch) return stackUrlMatch[0];
  }

  return null;
}
