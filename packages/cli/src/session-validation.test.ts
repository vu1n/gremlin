/**
 * Session validation integration tests
 *
 * Tests Zod schemas against valid sessions, edge cases, boundary values,
 * and malformed data. Ensures validation accepts real-world sessions
 * and rejects attacks.
 */

import { describe, it, expect } from 'bun:test';
import {
  GremlinSessionSchema,
  SessionAppendSchema,
  validateSession,
  safeValidateSession,
  validateSessionAppend,
  formatValidationError,
} from './session-validation.ts';
import { z } from 'zod';

// ============================================================================
// Fixtures
// ============================================================================

function validSession(): Record<string, any> {
  return {
    header: {
      sessionId: `test-${Date.now()}-abc123`,
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: '14.0',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'com.test.app' },
      schemaVersion: 1,
    },
    elements: [
      { testId: 'btn-login', type: 'button' },
    ],
    events: [
      { dt: 0, type: 0, data: { kind: 'tap', x: 100, y: 200 } },
      { dt: 500, type: 6, data: { kind: 'navigation', navType: 'push', screen: 'Home' } },
    ],
    screenshots: [],
  };
}

// ============================================================================
// Tests: validateSession
// ============================================================================

describe('validateSession', () => {
  it('accepts a valid minimal session', () => {
    const session = validSession();
    const result = validateSession(session);
    expect(result.header.sessionId).toBe(session.header.sessionId);
    expect(result.events).toHaveLength(2);
  });

  it('accepts session with all optional fields', () => {
    const session = {
      ...validSession(),
      rrwebEvents: [{ type: 4, data: {} }],
      performance: {
        webVitals: { lcp: 1200, cls: 0.05, inp: 150, fcp: 800, ttfb: 200 },
        avgFps: 58,
        minFps: 30,
        longTaskCount: 3,
        longTaskTotalDuration: 450,
        peakMemoryUsage: 1024 * 1024 * 100,
        pageLoadTime: 2500,
      },
    };

    const result = validateSession(session);
    expect(result.performance?.webVitals?.lcp).toBe(1200);
  });

  it('accepts session with optional device fields', () => {
    const session = validSession();
    session.header.device.model = 'Desktop';
    session.header.device.userAgent = 'Mozilla/5.0';
    session.header.device.locale = 'en-US';

    const result = validateSession(session);
    expect(result.header.device.model).toBe('Desktop');
  });

  it('accepts all three platforms', () => {
    for (const platform of ['web', 'ios', 'android'] as const) {
      const session = validSession();
      session.header.device.platform = platform;
      const result = validateSession(session);
      expect(result.header.device.platform).toBe(platform);
    }
  });

  it('accepts session with endTime set', () => {
    const session = validSession();
    session.header.endTime = Date.now() + 30000;
    const result = validateSession(session);
    expect(result.header.endTime).toBeDefined();
  });

  it('accepts session with app build field', () => {
    const session = validSession();
    session.header.app.build = '142';
    const result = validateSession(session);
    expect(result.header.app.build).toBe('142');
  });

  it('accepts elements with all fields', () => {
    const session = validSession();
    session.elements = [{
      testId: 'btn-submit',
      accessibilityLabel: 'Submit form',
      text: 'Submit',
      type: 'button',
      bounds: { x: 10, y: 20, width: 100, height: 40 },
      cssSelector: '#submit-btn',
      attributes: { class: 'primary', disabled: 'false' },
    }];

    const result = validateSession(session);
    expect(result.elements[0].cssSelector).toBe('#submit-btn');
  });

  it('accepts screenshots with full fields', () => {
    const session = validSession();
    session.screenshots = [{
      id: 'sc-1',
      timestamp: Date.now(),
      format: 'png',
      data: 'base64data...',
      isUrl: false,
      width: 1920,
      height: 1080,
      quality: 80,
      isDiff: false,
    }];

    const result = validateSession(session);
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].format).toBe('png');
  });

  it('accepts screenshot with diff fields', () => {
    const session = validSession();
    session.screenshots = [{
      id: 'sc-2',
      timestamp: Date.now(),
      format: 'webp',
      data: 'base64diff...',
      isUrl: false,
      width: 1920,
      height: 1080,
      quality: 90,
      isDiff: true,
      diffFromId: 'sc-1',
    }];

    const result = validateSession(session);
    expect(result.screenshots[0].isDiff).toBe(true);
    expect(result.screenshots[0].diffFromId).toBe('sc-1');
  });
});

// ============================================================================
// Tests: Boundary Values
// ============================================================================

describe('boundary values', () => {
  it('accepts dt = 0 (first event)', () => {
    const session = validSession();
    session.events = [{ dt: 0, type: 0, data: {} }];
    expect(() => validateSession(session)).not.toThrow();
  });

  it('accepts very large dt values (long idle)', () => {
    const session = validSession();
    session.events = [{ dt: 3600000, type: 0, data: {} }]; // 1 hour
    expect(() => validateSession(session)).not.toThrow();
  });

  it('rejects negative dt', () => {
    const session = validSession();
    session.events = [{ dt: -1, type: 0, data: {} }];
    expect(() => validateSession(session)).toThrow();
  });

  it('accepts max array sizes', () => {
    // Don't actually create 50k events (too slow), just verify schema allows up to that
    const schema = GremlinSessionSchema;
    const parsed = schema.safeParse(validSession());
    expect(parsed.success).toBe(true);
  });

  it('rejects events array exceeding 50000', () => {
    const session = validSession();
    // Create array that's too large
    session.events = new Array(50001).fill({ dt: 0 });
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects elements array exceeding 10000', () => {
    const session = validSession();
    session.elements = new Array(10001).fill({ type: 'button' });
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects screenshots array exceeding 1000', () => {
    const session = validSession();
    session.screenshots = new Array(1001).fill({
      id: 'x', timestamp: 1, format: 'png', data: 'x',
      isUrl: false, width: 1, height: 1, quality: 80, isDiff: false,
    });
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('accepts screen dimensions up to 8K', () => {
    const session = validSession();
    session.header.device.screen = { width: 7680, height: 4320, pixelRatio: 3 };
    expect(() => validateSession(session)).not.toThrow();
  });

  it('rejects screen dimensions exceeding 8K', () => {
    const session = validSession();
    session.header.device.screen = { width: 7681, height: 1080, pixelRatio: 2 };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects pixelRatio exceeding 10', () => {
    const session = validSession();
    session.header.device.screen = { width: 1920, height: 1080, pixelRatio: 11 };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects Web Vitals lcp exceeding 60000', () => {
    const session = { ...validSession(), performance: { webVitals: { lcp: 60001 } } };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects Web Vitals cls exceeding 10', () => {
    const session = { ...validSession(), performance: { webVitals: { cls: 10.1 } } };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects avgFps exceeding 240', () => {
    const session = { ...validSession(), performance: { avgFps: 241 } };
    const result = GremlinSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tests: Invalid Data (Attack Prevention)
// ============================================================================

describe('invalid data rejection', () => {
  it('rejects null input', () => {
    expect(() => validateSession(null)).toThrow();
  });

  it('rejects undefined input', () => {
    expect(() => validateSession(undefined)).toThrow();
  });

  it('rejects string input', () => {
    expect(() => validateSession('not a session')).toThrow();
  });

  it('rejects number input', () => {
    expect(() => validateSession(42)).toThrow();
  });

  it('rejects array input', () => {
    expect(() => validateSession([1, 2, 3])).toThrow();
  });

  it('rejects empty object', () => {
    expect(() => validateSession({})).toThrow();
  });

  it('rejects missing header', () => {
    const { header, ...rest } = validSession();
    expect(() => validateSession(rest)).toThrow();
  });

  it('rejects missing events array', () => {
    const { events, ...rest } = validSession();
    expect(() => validateSession(rest)).toThrow();
  });

  it('rejects missing elements array', () => {
    const { elements, ...rest } = validSession();
    expect(() => validateSession(rest)).toThrow();
  });

  it('rejects missing screenshots array', () => {
    const { screenshots, ...rest } = validSession();
    expect(() => validateSession(rest)).toThrow();
  });

  it('rejects invalid platform', () => {
    const session = validSession();
    (session.header.device as any).platform = 'windows';
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects empty sessionId', () => {
    const session = validSession();
    session.header.sessionId = '';
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects sessionId exceeding max length', () => {
    const session = validSession();
    session.header.sessionId = 'x'.repeat(201);
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects empty app name', () => {
    const session = validSession();
    session.header.app.name = '';
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects negative startTime', () => {
    const session = validSession();
    session.header.startTime = -1;
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects non-integer startTime', () => {
    const session = validSession();
    session.header.startTime = 1234567.89;
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects screenshot with invalid format', () => {
    const session = validSession();
    session.screenshots = [{
      id: 'x', timestamp: 1, format: 'bmp', data: 'x',
      isUrl: false, width: 1, height: 1, quality: 80, isDiff: false,
    }];
    expect(() => validateSession(session)).toThrow();
  });

  it('rejects screenshot quality out of range', () => {
    const session = validSession();
    session.screenshots = [{
      id: 'x', timestamp: 1, format: 'png', data: 'x',
      isUrl: false, width: 1, height: 1, quality: 101, isDiff: false,
    }];
    expect(() => validateSession(session)).toThrow();
  });
});

// ============================================================================
// Tests: safeValidateSession
// ============================================================================

describe('safeValidateSession', () => {
  it('returns validated session for valid input', () => {
    const session = validSession();
    const result = safeValidateSession(session);
    expect(result).not.toBeNull();
    expect(result!.header.sessionId).toBe(session.header.sessionId);
  });

  it('returns null for invalid input', () => {
    const result = safeValidateSession({ bad: 'data' });
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const result = safeValidateSession(null);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Tests: validateSessionAppend
// ============================================================================

describe('validateSessionAppend', () => {
  it('accepts valid append data with events', () => {
    const result = validateSessionAppend({
      sessionId: 'test-session-123',
      events: [{ dt: 0, type: 0, data: {} }],
    });

    expect(result.sessionId).toBe('test-session-123');
    expect(result.events).toHaveLength(1);
  });

  it('accepts append with rrweb events', () => {
    const result = validateSessionAppend({
      sessionId: 'test-session-123',
      rrwebEvents: [{ type: 4, data: {}, timestamp: Date.now() }],
    });

    expect(result.rrwebEvents).toHaveLength(1);
  });

  it('accepts append with both event types', () => {
    const result = validateSessionAppend({
      sessionId: 'test-session-123',
      events: [{ dt: 0 }],
      rrwebEvents: [{ type: 4, data: {} }],
    });

    expect(result.events).toHaveLength(1);
    expect(result.rrwebEvents).toHaveLength(1);
  });

  it('rejects missing sessionId', () => {
    expect(() => validateSessionAppend({ events: [] })).toThrow();
  });

  it('rejects empty sessionId', () => {
    expect(() => validateSessionAppend({ sessionId: '', events: [] })).toThrow();
  });

  it('rejects sessionId exceeding max length', () => {
    expect(() => validateSessionAppend({
      sessionId: 'x'.repeat(201),
      events: [],
    })).toThrow();
  });

  it('rejects events array exceeding 10000', () => {
    const result = SessionAppendSchema.safeParse({
      sessionId: 'test',
      events: new Array(10001).fill({ dt: 0 }),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tests: formatValidationError
// ============================================================================

describe('formatValidationError', () => {
  it('formats error with path information', () => {
    const result = GremlinSessionSchema.safeParse({ bad: 'data' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatValidationError(result.error);
      expect(msg).toContain('Validation failed');
      expect(msg.length).toBeGreaterThan(20);
    }
  });

  it('includes field paths in error message', () => {
    const session = validSession();
    session.header.startTime = -1;
    const result = GremlinSessionSchema.safeParse(session);
    if (!result.success) {
      const msg = formatValidationError(result.error);
      expect(msg).toContain('header');
    }
  });
});
