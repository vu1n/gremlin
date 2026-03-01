/**
 * Tests for session validation schemas and helper functions.
 *
 * Covers:
 * - GremlinSessionSchema: valid sessions, invalid data, boundary values
 * - validateSessionZod: throws on invalid, returns typed session
 * - safeValidateSession: returns null on invalid, data on valid
 * - validateSessionAppend: validates append payloads
 * - formatValidationError: formats ZodError into readable string
 */

import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import {
  GremlinSessionSchema,
  SessionAppendSchema,
  DeviceInfoSchema,
  AppInfoSchema,
  WebVitalsSchema,
  SessionPerformanceSchema,
  validateSessionZod,
  safeValidateSession,
  validateSessionAppend,
  formatValidationError,
} from './validation.ts';

// ============================================================================
// Helpers
// ============================================================================

function makeValidSession() {
  return {
    header: {
      sessionId: 'sess-001',
      startTime: 1700000000000,
      device: {
        platform: 'web' as const,
        osVersion: 'Linux',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: {
        name: 'TestApp',
        version: '1.0.0',
        identifier: 'com.test.app',
      },
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
  };
}

// ============================================================================
// GremlinSessionSchema - valid sessions
// ============================================================================

describe('GremlinSessionSchema', () => {
  test('accepts a minimal valid session', () => {
    const session = makeValidSession();
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  test('accepts a session with events and elements', () => {
    const session = {
      ...makeValidSession(),
      events: [
        { dt: 0, type: 1 },
        { dt: 100, type: 2, data: { key: 'value' } },
      ],
      elements: [
        { type: 'button', testId: 'btn-submit' },
      ],
    };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  test('accepts a session with optional performance data', () => {
    const session = {
      ...makeValidSession(),
      performance: {
        webVitals: { lcp: 2500, cls: 0.1, fcp: 1800 },
        avgFps: 60,
      },
    };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  test('accepts a session with rrwebEvents', () => {
    const session = {
      ...makeValidSession(),
      rrwebEvents: [{ type: 0, data: {} }, { type: 1, data: {} }],
    };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  // ============================================================================
  // GremlinSessionSchema - invalid sessions
  // ============================================================================

  test('rejects session missing header', () => {
    const result = GremlinSessionSchema.safeParse({
      elements: [],
      events: [],
      screenshots: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects session with empty sessionId', () => {
    const session = makeValidSession();
    session.header.sessionId = '';
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  test('rejects session with invalid platform', () => {
    const session = makeValidSession();
    (session.header.device as Record<string, unknown>).platform = 'desktop';
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  test('rejects session with negative startTime', () => {
    const session = makeValidSession();
    session.header.startTime = -1;
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  test('rejects events array exceeding max size (50000)', () => {
    const session = makeValidSession();
    (session as Record<string, unknown>).events = Array.from({ length: 50001 }, (_, i) => ({ dt: i }));
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  test('rejects screenshots array exceeding max size (1000)', () => {
    const session = makeValidSession();
    (session as Record<string, unknown>).screenshots = Array.from(
      { length: 1001 },
      (_, i) => ({
        id: `s${i}`,
        timestamp: 1700000000000,
        format: 'png',
        data: 'base64data',
        isUrl: false,
        width: 100,
        height: 100,
        quality: 80,
        isDiff: false,
      })
    );
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// DeviceInfoSchema
// ============================================================================

describe('DeviceInfoSchema', () => {
  test('accepts valid device info with all platforms', () => {
    for (const platform of ['web', 'ios', 'android'] as const) {
      const result = DeviceInfoSchema.safeParse({
        platform,
        osVersion: '17.0',
        screen: { width: 390, height: 844, pixelRatio: 3 },
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects screen dimensions exceeding 8K', () => {
    const result = DeviceInfoSchema.safeParse({
      platform: 'web',
      osVersion: '14',
      screen: { width: 8000, height: 1080, pixelRatio: 1 },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// WebVitalsSchema
// ============================================================================

describe('WebVitalsSchema', () => {
  test('accepts valid web vitals', () => {
    const result = WebVitalsSchema.safeParse({
      lcp: 2500,
      cls: 0.1,
      inp: 200,
      fcp: 1800,
      ttfb: 500,
    });
    expect(result.success).toBe(true);
  });

  test('accepts empty object (all fields optional)', () => {
    const result = WebVitalsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('rejects CLS value exceeding max (10)', () => {
    const result = WebVitalsSchema.safeParse({ cls: 11 });
    expect(result.success).toBe(false);
  });

  test('rejects negative LCP', () => {
    const result = WebVitalsSchema.safeParse({ lcp: -1 });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// validateSessionZod
// ============================================================================

describe('validateSessionZod', () => {
  test('returns validated session for valid data', () => {
    const session = makeValidSession();
    const result = validateSessionZod(session);
    expect(result.header.sessionId).toBe('sess-001');
    expect(result.events).toEqual([]);
  });

  test('throws ZodError for invalid data', () => {
    expect(() => validateSessionZod({})).toThrow();
  });

  test('throws ZodError for null input', () => {
    expect(() => validateSessionZod(null)).toThrow();
  });
});

// ============================================================================
// safeValidateSession
// ============================================================================

describe('safeValidateSession', () => {
  test('returns data for valid session', () => {
    const session = makeValidSession();
    const result = safeValidateSession(session);
    expect(result).not.toBeNull();
    expect(result!.header.sessionId).toBe('sess-001');
  });

  test('returns null for invalid session', () => {
    const result = safeValidateSession({ invalid: true });
    expect(result).toBeNull();
  });

  test('returns null for undefined', () => {
    const result = safeValidateSession(undefined);
    expect(result).toBeNull();
  });
});

// ============================================================================
// validateSessionAppend
// ============================================================================

describe('validateSessionAppend', () => {
  test('validates valid append payload', () => {
    const result = validateSessionAppend({
      sessionId: 'sess-001',
      events: [{ dt: 0 }, { dt: 100 }],
    });
    expect(result.sessionId).toBe('sess-001');
    expect(result.events).toHaveLength(2);
  });

  test('validates append with only sessionId', () => {
    const result = validateSessionAppend({ sessionId: 'sess-001' });
    expect(result.sessionId).toBe('sess-001');
  });

  test('validates append with rrwebEvents', () => {
    const result = validateSessionAppend({
      sessionId: 'sess-001',
      rrwebEvents: [{ type: 0 }],
    });
    expect(result.rrwebEvents).toHaveLength(1);
  });

  test('throws for missing sessionId', () => {
    expect(() => validateSessionAppend({})).toThrow();
  });

  test('throws for empty sessionId', () => {
    expect(() => validateSessionAppend({ sessionId: '' })).toThrow();
  });
});

// ============================================================================
// formatValidationError
// ============================================================================

describe('formatValidationError', () => {
  test('formats single validation issue', () => {
    const result = GremlinSessionSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatValidationError(result.error);
      expect(message).toContain('Validation failed');
    }
  });

  test('includes field path in formatted message', () => {
    const session = makeValidSession();
    session.header.sessionId = '';
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatValidationError(result.error);
      expect(message).toContain('header.sessionId');
    }
  });

  test('uses "root" for top-level issues', () => {
    const error = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'object',
        received: 'null',
        path: [],
        message: 'Expected object, received null',
      },
    ]);
    const message = formatValidationError(error);
    expect(message).toContain('root');
    expect(message).toContain('Expected object, received null');
  });

  test('joins multiple issues with commas', () => {
    const error = new z.ZodError([
      { code: 'invalid_type', expected: 'string', received: 'number', path: ['a'], message: 'err1' },
      { code: 'invalid_type', expected: 'string', received: 'number', path: ['b'], message: 'err2' },
    ]);
    const message = formatValidationError(error);
    expect(message).toContain('a: err1');
    expect(message).toContain('b: err2');
    expect(message).toContain(', ');
  });
});
