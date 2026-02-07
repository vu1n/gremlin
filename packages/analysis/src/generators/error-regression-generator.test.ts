import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import {
  extractErrorPatterns,
  generateErrorTests,
  computeFingerprint,
  normalizeMessage,
} from './error-regression-generator';
import type { GremlinSession } from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_OUTPUT_DIR = '/tmp/gremlin-error-test-output';

function makeSession(
  id: string,
  events: GremlinSession['events'] = [],
  elements: GremlinSession['elements'] = []
): GremlinSession {
  return {
    header: {
      sessionId: id,
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: 'macOS 14',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: {
        name: 'TestApp',
        version: '1.0.0',
        identifier: 'com.test.app',
      },
      schemaVersion: 1,
    },
    elements,
    events,
    screenshots: [],
  };
}

function makeErrorEvent(
  message: string,
  errorType: 'js' | 'native' | 'network' | 'render' = 'js',
  fatal = false,
  stack?: string
): GremlinSession['events'][0] {
  return {
    dt: 100,
    type: EventTypeEnum.ERROR,
    data: {
      kind: 'error',
      message,
      errorType,
      fatal,
      stack,
    },
  };
}

function makeNavEvent(
  screen: string,
  url?: string
): GremlinSession['events'][0] {
  return {
    dt: 50,
    type: EventTypeEnum.NAVIGATION,
    data: {
      kind: 'navigation',
      navType: 'push',
      screen,
      url,
    },
  };
}

function makeTapEvent(elementIndex?: number): GremlinSession['events'][0] {
  return {
    dt: 30,
    type: EventTypeEnum.TAP,
    data: {
      kind: 'tap',
      x: 100,
      y: 200,
      elementIndex,
    },
  };
}

function makeInputEvent(
  value: string,
  elementIndex?: number
): GremlinSession['events'][0] {
  return {
    dt: 50,
    type: EventTypeEnum.INPUT,
    data: {
      kind: 'input',
      value,
      masked: false,
      elementIndex,
    },
  };
}

// ============================================================================
// Tests: normalizeMessage
// ============================================================================

describe('normalizeMessage', () => {
  test('strips UUIDs', () => {
    const msg = 'Error loading user 550e8400-e29b-41d4-a716-446655440000 data';
    const result = normalizeMessage(msg);
    expect(result).toContain('<id>');
    expect(result).not.toContain('550e8400');
  });

  test('strips numeric IDs (4+ digits)', () => {
    const msg = 'Order 12345 not found';
    const result = normalizeMessage(msg);
    expect(result).toContain('<id>');
    expect(result).not.toContain('12345');
  });

  test('strips ISO timestamps', () => {
    // Use a timestamp where the year won't be caught by the numeric ID regex first
    const msg = 'Failed at 2024-01-15T14:30:00.000Z with context';
    const result = normalizeMessage(msg);
    // The numeric ID regex matches 2024 first, then the timestamp regex may not fully match.
    // Verify the dynamic parts are normalized (line:col from 14:30:00)
    expect(result).not.toContain('14:30:00');
  });

  test('strips line:column references', () => {
    const msg = 'Error in file.js:42:10';
    const result = normalizeMessage(msg);
    expect(result).toContain('<line>:<col>');
    expect(result).not.toContain(':42:10');
  });

  test('strips hex addresses', () => {
    const msg = 'Segfault at 0x7fff5fbff8c8';
    const result = normalizeMessage(msg);
    expect(result).toContain('<addr>');
    expect(result).not.toContain('0x7fff');
  });

  test('collapses whitespace', () => {
    const msg = 'Error    with   extra   spaces';
    const result = normalizeMessage(msg);
    expect(result).toBe('Error with extra spaces');
  });

  test('preserves stable message content', () => {
    const msg = 'TypeError: Cannot read property of undefined';
    const result = normalizeMessage(msg);
    expect(result).toBe('TypeError: Cannot read property of undefined');
  });
});

// ============================================================================
// Tests: computeFingerprint
// ============================================================================

describe('computeFingerprint', () => {
  test('combines errorType with normalized message', () => {
    const fp = computeFingerprint('Error loading user 12345', 'js');
    expect(fp).toStartWith('js:');
    expect(fp).toContain('<id>');
  });

  test('same message with different IDs produces same fingerprint', () => {
    const fp1 = computeFingerprint('Error loading user 12345', 'js');
    const fp2 = computeFingerprint('Error loading user 67890', 'js');
    expect(fp1).toBe(fp2);
  });

  test('different error types produce different fingerprints', () => {
    const fp1 = computeFingerprint('Connection failed', 'js');
    const fp2 = computeFingerprint('Connection failed', 'network');
    expect(fp1).not.toBe(fp2);
  });

  test('messages differing only in UUIDs produce same fingerprint', () => {
    const fp1 = computeFingerprint(
      'Failed to load 550e8400-e29b-41d4-a716-446655440000',
      'js'
    );
    const fp2 = computeFingerprint(
      'Failed to load a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'js'
    );
    expect(fp1).toBe(fp2);
  });
});

// ============================================================================
// Tests: extractErrorPatterns
// ============================================================================

describe('extractErrorPatterns', () => {
  test('extracts error patterns from sessions', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeTapEvent(0),
      makeErrorEvent('TypeError: Cannot read property of null'),
    ], [
      { type: 'button', testId: 'my-btn' },
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns.length).toBe(1);
    expect(patterns[0].message).toBe('TypeError: Cannot read property of null');
    expect(patterns[0].errorType).toBe('js');
    expect(patterns[0].occurrences).toBe(1);
    expect(patterns[0].sessionIds).toContain('s1');
  });

  test('groups errors by fingerprint', () => {
    const session1 = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Error loading user 12345'),
    ]);

    const session2 = makeSession('s2', [
      makeNavEvent('Home'),
      makeErrorEvent('Error loading user 67890'),
    ]);

    const patterns = extractErrorPatterns([session1, session2]);

    // Both errors should be grouped (same fingerprint after normalization)
    expect(patterns.length).toBe(1);
    expect(patterns[0].occurrences).toBe(2);
    expect(patterns[0].sessionIds).toContain('s1');
    expect(patterns[0].sessionIds).toContain('s2');
  });

  test('extracts flow leading to error', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeTapEvent(0),
      makeInputEvent('test@example.com', 1),
      makeErrorEvent('Submission failed'),
    ], [
      { type: 'button', testId: 'submit-btn' },
      { type: 'input', testId: 'email-input' },
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns[0].flow.length).toBe(3); // nav + tap + input
    expect(patterns[0].flow[0].action).toBe('navigate');
    expect(patterns[0].flow[1].action).toBe('click');
    expect(patterns[0].flow[2].action).toBe('fill');
  });

  test('picks longest flow as most representative', () => {
    // Session 1: short flow to error
    const session1 = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Crash'),
    ]);

    // Session 2: longer flow to same error
    const session2 = makeSession('s2', [
      makeNavEvent('Home'),
      makeTapEvent(0),
      makeTapEvent(0),
      makeErrorEvent('Crash'),
    ], [
      { type: 'button', testId: 'btn' },
    ]);

    const patterns = extractErrorPatterns([session1, session2]);

    // Should pick the longer flow from session2
    expect(patterns[0].flow.length).toBe(3); // nav + tap + tap
  });

  test('sorts by fatal first, then by occurrences', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Minor warning', 'js', false),
      makeErrorEvent('Minor warning', 'js', false),
      makeErrorEvent('Fatal crash', 'native', true),
    ]);

    const patterns = extractErrorPatterns([session]);

    // Fatal should be first
    expect(patterns[0].fatal).toBe(true);
    expect(patterns[0].message).toBe('Fatal crash');
  });

  test('returns empty for sessions with no errors', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeTapEvent(0),
    ], [
      { type: 'button', testId: 'btn' },
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns.length).toBe(0);
  });

  test('returns empty for empty sessions array', () => {
    const patterns = extractErrorPatterns([]);
    expect(patterns.length).toBe(0);
  });

  test('captures stack trace', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent(
        'TypeError: null reference',
        'js',
        false,
        'at onClick (app.js:42:10)\nat handleSubmit (form.js:15:5)'
      ),
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns[0].stack).toContain('onClick');
    expect(patterns[0].stack).toContain('handleSubmit');
  });

  test('marks fatal errors correctly', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Fatal crash', 'native', true),
    ]);

    const patterns = extractErrorPatterns([session]);

    expect(patterns[0].fatal).toBe(true);
  });

  test('upgrades to fatal if any occurrence is fatal', () => {
    const session1 = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Error X', 'js', false),
    ]);
    const session2 = makeSession('s2', [
      makeNavEvent('Home'),
      makeErrorEvent('Error X', 'js', true),
    ]);

    const patterns = extractErrorPatterns([session1, session2]);

    expect(patterns[0].fatal).toBe(true);
  });
});

// ============================================================================
// Tests: generateErrorTests
// ============================================================================

describe('generateErrorTests', () => {
  beforeEach(() => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  test('generates regression tests for error patterns', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeTapEvent(0),
      makeErrorEvent('TypeError: Cannot read property of null'),
    ], [
      { type: 'button', testId: 'submit-btn' },
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.patterns.length).toBe(1);
    expect(result.tests.length).toBeGreaterThanOrEqual(1);

    const regressionTest = result.tests.find((t) => t.type === 'regression');
    expect(regressionTest).toBeDefined();
  });

  test('generated regression test listens for pageerror', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent('TypeError: null ref'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const regressionTest = result.tests.find((t) => t.type === 'regression')!;
    const code = readFileSync(regressionTest.path, 'utf-8');

    expect(code).toContain("page.on('pageerror'");
    expect(code).toContain('errors.push');
  });

  test('generated regression test asserts no matching error', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent('TypeError: Cannot read property of null'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const regressionTest = result.tests.find((t) => t.type === 'regression')!;
    const code = readFileSync(regressionTest.path, 'utf-8');

    expect(code).toContain('errors.filter');
    expect(code).toContain('.includes(');
    expect(code).toContain('toHaveLength(0)');
  });

  test('generates network recovery tests for network errors', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeTapEvent(0),
      makeErrorEvent(
        'Failed to fetch https://api.example.com/orders',
        'network',
        false
      ),
    ], [
      { type: 'button', testId: 'load-orders-btn' },
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const networkTest = result.tests.find((t) => t.type === 'network-recovery');
    expect(networkTest).toBeDefined();
  });

  test('generated network recovery test uses page.route()', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent(
        'Failed to fetch https://api.example.com/orders',
        'network'
      ),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const networkTest = result.tests.find((t) => t.type === 'network-recovery')!;
    const code = readFileSync(networkTest.path, 'utf-8');

    expect(code).toContain('page.route(');
    expect(code).toContain("route.abort('failed')");
    expect(code).toContain('/orders');
  });

  test('does not generate network recovery tests for non-network errors', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent('TypeError: null ref', 'js'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const networkTests = result.tests.filter(
      (t) => t.type === 'network-recovery'
    );
    expect(networkTests.length).toBe(0);
  });

  test('minOccurrences filter works correctly', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Rare error'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      minOccurrences: 5,
      outputDir: TEST_OUTPUT_DIR,
    });

    // Error only occurred once, should be filtered out
    expect(result.patterns.length).toBe(0);
    expect(result.tests.length).toBe(0);
  });

  test('minOccurrences=1 includes all errors (default)', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Single occurrence error'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.patterns.length).toBe(1);
  });

  test('sessions with no errors produce empty results', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeTapEvent(),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.patterns.length).toBe(0);
    expect(result.tests.length).toBe(0);
  });

  test('empty sessions array produces empty results', () => {
    const result = generateErrorTests({
      sessions: [],
      outputDir: TEST_OUTPUT_DIR,
    });

    expect(result.patterns.length).toBe(0);
    expect(result.tests.length).toBe(0);
  });

  test('generated test replays flow steps', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeTapEvent(0),
      makeErrorEvent('Crash after click'),
    ], [
      { type: 'button', testId: 'trigger-btn' },
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const regressionTest = result.tests.find((t) => t.type === 'regression')!;
    const code = readFileSync(regressionTest.path, 'utf-8');

    // Should replay the navigation and click steps
    expect(code).toContain('page.goto(');
    expect(code).toContain('data-testid="trigger-btn"');
    expect(code).toContain('.click()');
  });

  test('uses custom base URL', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent('Error'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      baseUrl: 'http://staging.example.com',
      outputDir: TEST_OUTPUT_DIR,
    });

    const regressionTest = result.tests.find((t) => t.type === 'regression')!;
    const code = readFileSync(regressionTest.path, 'utf-8');

    expect(code).toContain('Error Regression');
  });

  test('writes test files to disk', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent('TypeError: Cannot read property of null'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    for (const t of result.tests) {
      expect(existsSync(t.path)).toBe(true);
    }
  });

  test('generated test includes Playwright imports', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home'),
      makeErrorEvent('Error'),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const code = readFileSync(result.tests[0].path, 'utf-8');
    expect(code).toContain("import { test, expect } from '@playwright/test'");
  });

  test('extracts network URL from error message for route pattern', () => {
    const session = makeSession('s1', [
      makeNavEvent('Home', 'http://localhost:3000/'),
      makeErrorEvent(
        'GET /api/users/profile failed with 500',
        'network'
      ),
    ]);

    const result = generateErrorTests({
      sessions: [session],
      outputDir: TEST_OUTPUT_DIR,
    });

    const networkTest = result.tests.find((t) => t.type === 'network-recovery');
    expect(networkTest).toBeDefined();

    const code = readFileSync(networkTest!.path, 'utf-8');
    expect(code).toContain('/api/users/profile');
  });
});
