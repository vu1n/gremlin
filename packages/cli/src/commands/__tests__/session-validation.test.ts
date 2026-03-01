import { describe, test, expect } from 'bun:test';
import {
  validateSession,
  safeValidateSession,
  formatValidationError,
} from '../../session-validation.ts';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSessionData() {
  return {
    header: {
      sessionId: 'test-session-1',
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: 'macOS 14',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: {
        name: 'TestApp',
        version: '1.0.0',
        identifier: 'https://test.com',
      },
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
  };
}

// ---------------------------------------------------------------------------
// validateSession (throws on invalid)
// ---------------------------------------------------------------------------

describe('validateSession', () => {
  test('accepts a valid minimal session', () => {
    const data = validSessionData();
    const result = validateSession(data);
    expect(result.header.sessionId).toBe('test-session-1');
  });

  test('accepts session with events', () => {
    const data = validSessionData();
    (data as Record<string, unknown>).events = [{ dt: 100, type: 0, data: { kind: 'tap', x: 10, y: 20 } }];
    const result = validateSession(data);
    expect(result.events).toHaveLength(1);
  });

  test('accepts session with performance data', () => {
    const data = {
      ...validSessionData(),
      performance: {
        webVitals: { lcp: 2000, fcp: 1500 },
        avgFps: 60,
      },
    };
    const result = validateSession(data);
    expect(result.performance).toBeDefined();
  });

  test('throws on missing header', () => {
    expect(() => validateSession({ elements: [], events: [], screenshots: [] })).toThrow();
  });

  test('throws on invalid platform', () => {
    const data = validSessionData();
    data.header.device.platform = 'windows' as any;
    expect(() => validateSession(data)).toThrow();
  });

  test('throws on negative startTime', () => {
    const data = validSessionData();
    data.header.startTime = -1;
    expect(() => validateSession(data)).toThrow();
  });

  test('throws on empty app name', () => {
    const data = validSessionData();
    data.header.app.name = '';
    expect(() => validateSession(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// safeValidateSession (returns null on invalid)
// ---------------------------------------------------------------------------

describe('safeValidateSession', () => {
  test('returns validated data for valid session', () => {
    const data = validSessionData();
    const result = safeValidateSession(data);
    expect(result).not.toBeNull();
    expect(result!.header.sessionId).toBe('test-session-1');
  });

  test('returns null for invalid data', () => {
    const result = safeValidateSession({});
    expect(result).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(safeValidateSession(null)).toBeNull();
    expect(safeValidateSession('string')).toBeNull();
    expect(safeValidateSession(42)).toBeNull();
  });

  test('returns null for missing required fields', () => {
    const result = safeValidateSession({ header: {} });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatValidationError
// ---------------------------------------------------------------------------

describe('formatValidationError', () => {
  test('formats a single validation error', () => {
    const error = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['header', 'sessionId'],
        message: 'Expected string, received number',
      },
    ]);
    const result = formatValidationError(error);
    expect(result).toContain('Validation failed');
    expect(result).toContain('header.sessionId');
    expect(result).toContain('Expected string, received number');
  });

  test('formats multiple validation errors', () => {
    const error = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['header', 'sessionId'],
        message: 'Required',
      },
      {
        code: 'invalid_type',
        expected: 'number',
        received: 'string',
        path: ['header', 'startTime'],
        message: 'Expected number, received string',
      },
    ]);
    const result = formatValidationError(error);
    expect(result).toContain('header.sessionId');
    expect(result).toContain('header.startTime');
  });

  test('uses "root" for empty path', () => {
    const error = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'object',
        received: 'string',
        path: [],
        message: 'Expected object, received string',
      },
    ]);
    const result = formatValidationError(error);
    expect(result).toContain('root');
  });
});
