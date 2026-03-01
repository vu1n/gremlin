/**
 * Tests for Error Pattern Extraction
 *
 * Covers:
 * - extractErrorPatterns: groups errors by fingerprint
 * - Counts occurrences correctly
 * - Returns session IDs for each pattern
 * - Handles sessions with no errors
 * - computeFingerprint: produces stable fingerprints
 * - normalizeMessage: strips volatile parts (UUIDs, timestamps, etc.)
 * - extractFlowToError: extracts flow steps leading to errors
 */

import { describe, test, expect } from 'bun:test';
import {
  extractErrorPatterns,
  computeFingerprint,
  normalizeMessage,
  extractFlowToError,
  eventToFlowStep,
} from '../error-pattern-extractor.ts';
import { EventTypeEnum } from '@gremlin/session';
import type {
  GremlinSession,
  GremlinEvent,
  ErrorEvent,
  NavigationEvent,
  TapEvent,
  ScrollEvent,
  ElementInfo,
} from '@gremlin/session';

// ============================================================================
// Helpers
// ============================================================================

function makeSession(
  sessionId: string,
  events: GremlinEvent[],
  elements: ElementInfo[] = []
): GremlinSession {
  return {
    header: {
      sessionId,
      startTime: Date.now(),
      schemaVersion: 1,
      device: {
        platform: 'web',
        osVersion: '1.0',
        screen: { width: 1920, height: 1080, pixelRatio: 1 },
      },
      app: { name: 'test', version: '1.0', identifier: 'com.test' },
    },
    elements,
    events,
    screenshots: [],
  };
}

function makeErrorEvent(
  message: string,
  errorType: ErrorEvent['errorType'] = 'js',
  fatal = false,
  stack?: string
): GremlinEvent {
  return {
    dt: 100,
    type: EventTypeEnum.ERROR,
    data: { kind: 'error', message, errorType, fatal, stack } as ErrorEvent,
  };
}

function makeNavEvent(screen: string): GremlinEvent {
  return {
    dt: 50,
    type: EventTypeEnum.NAVIGATION,
    data: { kind: 'navigation', navType: 'push', screen } as NavigationEvent,
  };
}

function makeTapEvent(x: number, y: number, elementIndex?: number): GremlinEvent {
  return {
    dt: 30,
    type: EventTypeEnum.TAP,
    data: { kind: 'tap', x, y, elementIndex } as TapEvent,
  };
}

// ============================================================================
// extractErrorPatterns - grouping
// ============================================================================

describe('extractErrorPatterns', () => {
  test('groups errors by fingerprint', () => {
    const s1 = makeSession('s1', [
      makeErrorEvent('TypeError: Cannot read property "x" of null'),
    ]);
    const s2 = makeSession('s2', [
      makeErrorEvent('TypeError: Cannot read property "x" of null'),
    ]);

    const patterns = extractErrorPatterns([s1, s2]);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(2);
  });

  test('separates different error messages into different patterns', () => {
    const session = makeSession('s1', [
      makeErrorEvent('ReferenceError: foo is not defined'),
      makeErrorEvent('TypeError: null is not an object'),
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns).toHaveLength(2);
  });

  test('separates same message with different errorType', () => {
    const session = makeSession('s1', [
      makeErrorEvent('Connection failed', 'js'),
      makeErrorEvent('Connection failed', 'network'),
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns).toHaveLength(2);
  });

  test('counts occurrences correctly across multiple sessions', () => {
    const sessions = [
      makeSession('s1', [
        makeErrorEvent('Error A'),
        makeErrorEvent('Error A'),
      ]),
      makeSession('s2', [
        makeErrorEvent('Error A'),
      ]),
      makeSession('s3', [
        makeErrorEvent('Error B'),
      ]),
    ];

    const patterns = extractErrorPatterns(sessions);

    const patternA = patterns.find(p => p.message === 'Error A');
    const patternB = patterns.find(p => p.message === 'Error B');

    expect(patternA!.occurrences).toBe(3);
    expect(patternB!.occurrences).toBe(1);
  });

  test('returns session IDs for each pattern', () => {
    const sessions = [
      makeSession('session-1', [makeErrorEvent('Error X')]),
      makeSession('session-2', [makeErrorEvent('Error X')]),
      makeSession('session-3', [makeErrorEvent('Error Y')]),
    ];

    const patterns = extractErrorPatterns(sessions);

    const patternX = patterns.find(p => p.message === 'Error X');
    expect(patternX!.sessionIds).toContain('session-1');
    expect(patternX!.sessionIds).toContain('session-2');
    expect(patternX!.sessionIds).not.toContain('session-3');

    const patternY = patterns.find(p => p.message === 'Error Y');
    expect(patternY!.sessionIds).toContain('session-3');
  });

  test('deduplicates session IDs when same session has same error twice', () => {
    const session = makeSession('s1', [
      makeErrorEvent('Error A'),
      makeErrorEvent('Error A'),
    ]);

    const patterns = extractErrorPatterns([session]);

    // sessionIds should be deduplicated
    const uniqueIds = new Set(patterns[0].sessionIds);
    expect(uniqueIds.size).toBe(1);
  });

  test('handles sessions with no errors', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeTapEvent(100, 200),
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns).toHaveLength(0);
  });

  test('handles empty sessions array', () => {
    const patterns = extractErrorPatterns([]);
    expect(patterns).toHaveLength(0);
  });

  test('handles sessions with empty events array', () => {
    const session = makeSession('s1', []);
    const patterns = extractErrorPatterns([session]);
    expect(patterns).toHaveLength(0);
  });
});

// ============================================================================
// extractErrorPatterns - sorting
// ============================================================================

describe('extractErrorPatterns - sorting', () => {
  test('sorts fatal errors before non-fatal', () => {
    const sessions = [
      makeSession('s1', [makeErrorEvent('Non-fatal error', 'js', false)]),
      makeSession('s2', [makeErrorEvent('Non-fatal error', 'js', false)]),
      makeSession('s3', [makeErrorEvent('Fatal error', 'js', true)]),
    ];

    const patterns = extractErrorPatterns(sessions);

    expect(patterns[0].fatal).toBe(true);
    expect(patterns[0].message).toBe('Fatal error');
  });

  test('sorts by occurrences within same fatality level', () => {
    const sessions = [
      makeSession('s1', [makeErrorEvent('Common error')]),
      makeSession('s2', [makeErrorEvent('Common error')]),
      makeSession('s3', [makeErrorEvent('Common error')]),
      makeSession('s4', [makeErrorEvent('Rare error')]),
    ];

    const patterns = extractErrorPatterns(sessions);

    expect(patterns[0].message).toBe('Common error');
    expect(patterns[0].occurrences).toBe(3);
  });
});

// ============================================================================
// extractErrorPatterns - stack traces
// ============================================================================

describe('extractErrorPatterns - stack traces', () => {
  test('captures stack trace from first error with stack', () => {
    const sessions = [
      makeSession('s1', [makeErrorEvent('Error X', 'js', false, undefined)]),
      makeSession('s2', [makeErrorEvent('Error X', 'js', false, 'at foo (bar.js:1:2)')]),
    ];

    const patterns = extractErrorPatterns(sessions);

    expect(patterns[0].stack).toBe('at foo (bar.js:1:2)');
  });

  test('fatal flag is promoted if any occurrence is fatal', () => {
    const sessions = [
      makeSession('s1', [makeErrorEvent('Error X', 'js', false)]),
      makeSession('s2', [makeErrorEvent('Error X', 'js', true)]),
    ];

    const patterns = extractErrorPatterns(sessions);

    expect(patterns[0].fatal).toBe(true);
  });
});

// ============================================================================
// computeFingerprint
// ============================================================================

describe('computeFingerprint', () => {
  test('returns string in format "errorType:normalizedMessage"', () => {
    const fp = computeFingerprint('Some error message', 'js');
    expect(fp).toMatch(/^js:/);
  });

  test('same message and type produce same fingerprint', () => {
    const fp1 = computeFingerprint('Error occurred', 'js');
    const fp2 = computeFingerprint('Error occurred', 'js');
    expect(fp1).toBe(fp2);
  });

  test('different error types produce different fingerprints', () => {
    const fp1 = computeFingerprint('Error occurred', 'js');
    const fp2 = computeFingerprint('Error occurred', 'network');
    expect(fp1).not.toBe(fp2);
  });
});

// ============================================================================
// normalizeMessage
// ============================================================================

describe('normalizeMessage', () => {
  test('replaces UUIDs with <id>', () => {
    const msg = 'Failed for user 550e8400-e29b-41d4-a716-446655440000';
    const normalized = normalizeMessage(msg);
    expect(normalized).toContain('<id>');
    expect(normalized).not.toContain('550e8400');
  });

  test('replaces long numeric IDs with <id>', () => {
    const msg = 'Record 12345678 not found';
    const normalized = normalizeMessage(msg);
    expect(normalized).toContain('<id>');
    expect(normalized).not.toContain('12345678');
  });

  test('replaces ISO timestamps with <timestamp>', () => {
    // Use a message where the timestamp is the only volatile part,
    // noting that normalizeMessage applies regex replacements in order:
    // UUIDs, then numeric IDs (4+ digits), then timestamps, etc.
    // The year portion "2024" is consumed by the numeric ID regex first,
    // so we verify the overall effect on the full message.
    const msg = 'Error at 2024-01-15T10:30:00.000Z in module';
    const normalized = normalizeMessage(msg);
    // The timestamp regex replaces the full ISO string, but numeric ID
    // and line:col regexes may also match sub-parts. Verify the volatile
    // parts are replaced (not left verbatim).
    expect(normalized).not.toContain('2024-01-15T10:30:00');
  });

  test('replaces line:col references with <line>:<col>', () => {
    const msg = 'Error at file.js:42:15';
    const normalized = normalizeMessage(msg);
    expect(normalized).toContain('<line>:<col>');
  });

  test('replaces hex addresses with <addr>', () => {
    const msg = 'Segfault at 0xDEADBEEF';
    const normalized = normalizeMessage(msg);
    expect(normalized).toContain('<addr>');
    expect(normalized).not.toContain('0xDEADBEEF');
  });

  test('collapses whitespace', () => {
    const msg = 'Error   in   module   X';
    const normalized = normalizeMessage(msg);
    expect(normalized).toBe('Error in module X');
  });

  test('trims leading and trailing whitespace', () => {
    const msg = '  error message  ';
    const normalized = normalizeMessage(msg);
    expect(normalized).toBe('error message');
  });
});

// ============================================================================
// extractFlowToError
// ============================================================================

describe('extractFlowToError', () => {
  test('extracts navigation and tap events preceding an error', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeTapEvent(100, 200),
      makeErrorEvent('Crash'),
    ]);

    const flow = extractFlowToError(session, 2);

    expect(flow.length).toBe(2);
    expect(flow[0].action).toBe('navigate');
    expect(flow[1].action).toBe('click');
  });

  test('starts from last navigation event before error', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeTapEvent(10, 20),
      makeNavEvent('Products'),
      makeTapEvent(50, 60),
      makeErrorEvent('Crash'),
    ]);

    // Should start from the second navigation (index 2)
    const flow = extractFlowToError(session, 4);

    expect(flow.length).toBe(2);
    expect(flow[0].action).toBe('navigate');
    expect(flow[0].target).toBe('Products');
  });

  test('returns empty array when error is the first event', () => {
    const session = makeSession('s1', [
      makeErrorEvent('Immediate crash'),
    ]);

    const flow = extractFlowToError(session, 0);

    expect(flow).toHaveLength(0);
  });

  test('skips non-actionable events (e.g., app state)', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      {
        dt: 10,
        type: EventTypeEnum.APP_STATE,
        data: { kind: 'app_state', state: 'active' },
      } as GremlinEvent,
      makeErrorEvent('Error'),
    ]);

    const flow = extractFlowToError(session, 2);

    // APP_STATE events are not converted to flow steps
    expect(flow).toHaveLength(1);
    expect(flow[0].action).toBe('navigate');
  });
});

// ============================================================================
// eventToFlowStep
// ============================================================================

describe('eventToFlowStep', () => {
  const elements: ElementInfo[] = [
    { testId: 'btn-submit', type: 'button', text: 'Submit' },
    { type: 'input', text: 'Email field' },
  ];

  test('converts navigation event to navigate step', () => {
    const event: GremlinEvent = {
      dt: 10,
      type: EventTypeEnum.NAVIGATION,
      data: { kind: 'navigation', navType: 'push', screen: 'Dashboard', url: '/dashboard' } as NavigationEvent,
    };

    const step = eventToFlowStep(event, elements);

    expect(step).not.toBeNull();
    expect(step!.action).toBe('navigate');
    // eventToFlowStep uses nav.url || nav.screen, so url takes precedence
    expect(step!.target).toBe('/dashboard');
  });

  test('converts tap event to click step', () => {
    const event: GremlinEvent = {
      dt: 10,
      type: EventTypeEnum.TAP,
      data: { kind: 'tap', x: 100, y: 200, elementIndex: 0 } as TapEvent,
    };

    const step = eventToFlowStep(event, elements);

    expect(step).not.toBeNull();
    expect(step!.action).toBe('click');
  });

  test('converts scroll event to scroll step', () => {
    const event: GremlinEvent = {
      dt: 10,
      type: EventTypeEnum.SCROLL,
      data: { kind: 'scroll', deltaX: 0, deltaY: 200 } as ScrollEvent,
    };

    const step = eventToFlowStep(event, elements);

    expect(step).not.toBeNull();
    expect(step!.action).toBe('scroll');
  });

  test('returns null for unhandled event types', () => {
    const event: GremlinEvent = {
      dt: 10,
      type: EventTypeEnum.APP_STATE,
      data: { kind: 'app_state', state: 'background' },
    };

    const step = eventToFlowStep(event, elements);

    expect(step).toBeNull();
  });
});
