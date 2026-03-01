/**
 * Session Barrel API Surface Tests
 *
 * Verifies that all public exports from @gremlin/session are importable
 * and have the expected shape. This acts as a contract test to catch
 * accidental breaking changes to the public API.
 *
 * Covers:
 * - All public exports are importable
 * - Key types exist (verified via runtime usage)
 * - Runtime exports work (createSession, generateSessionId, addEvent, SCHEMA_VERSION, SDK_VERSION)
 * - EventTypeEnum values are correct
 */

import { describe, test, expect } from 'bun:test';

// Import everything from the barrel to verify the public API surface
import {
  // Constants
  SCHEMA_VERSION,
  SDK_VERSION,
  VERSION,

  // Runtime helpers
  createSession,
  generateSessionId,
  addEvent,
  getOrCreateElement,

  // Enum
  EventTypeEnum,

  // Classes
  EventBatcher,
  BaseRecorder,
  NetworkInterceptor,
  sanitizeUrl,
  shouldIgnoreUrl,
} from '../index.ts';

// Import types to verify they exist (compile-time check)
import type {
  GremlinSession,
  SessionHeader,
  DeviceInfo,
  AppInfo,
  ElementInfo,
  ElementType,
  Rect,
  GremlinEvent,
  EventData,
  TapEvent,
  SwipeEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  NetworkEvent,
  ScreenCaptureEvent,
  ErrorEvent,
  AppStateEvent,
  PerformanceSample,
  WebVitals,
  SessionPerformance,
  Screenshot,
  SessionAnalytics,
  UploadResult,
  ScrollBatch,
  BatcherConfig,
  BatcherCallbacks,
  BaseRecorderConfig,
  SessionMetadata,
  NetworkInterceptorConfig,
} from '../index.ts';

// ============================================================================
// Constants
// ============================================================================

describe('constants', () => {
  test('SCHEMA_VERSION is exported and is a number', () => {
    expect(typeof SCHEMA_VERSION).toBe('number');
  });

  test('SDK_VERSION is exported and is a string', () => {
    expect(typeof SDK_VERSION).toBe('string');
  });

  test('VERSION is exported as deprecated alias of SDK_VERSION', () => {
    expect(VERSION).toBe(SDK_VERSION);
  });
});

// ============================================================================
// Runtime helpers
// ============================================================================

describe('runtime exports', () => {
  const testDevice: DeviceInfo = {
    platform: 'web',
    osVersion: '1.0',
    screen: { width: 1920, height: 1080, pixelRatio: 1 },
  };

  const testApp: AppInfo = {
    name: 'test-app',
    version: '1.0.0',
    identifier: 'com.test.app',
  };

  test('createSession is a function and returns a valid session', () => {
    expect(typeof createSession).toBe('function');

    const session = createSession(testDevice, testApp);

    expect(session).toBeDefined();
    expect(session.header).toBeDefined();
    expect(session.header.sessionId).toBeTruthy();
    expect(session.header.schemaVersion).toBe(SCHEMA_VERSION);
    expect(session.elements).toEqual([]);
    expect(session.events).toEqual([]);
    expect(session.screenshots).toEqual([]);
  });

  test('generateSessionId is a function and returns a string', () => {
    expect(typeof generateSessionId).toBe('function');

    const id = generateSessionId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('generateSessionId produces unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSessionId());
    }
    expect(ids.size).toBe(100);
  });

  test('addEvent is a function and appends event to session', () => {
    expect(typeof addEvent).toBe('function');

    const session = createSession(testDevice, testApp);
    const prevTimestamp = Date.now();

    const newTimestamp = addEvent(
      session,
      { type: EventTypeEnum.TAP, data: { kind: 'tap', x: 100, y: 200 } as TapEvent },
      prevTimestamp
    );

    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe(EventTypeEnum.TAP);
    expect(typeof session.events[0].dt).toBe('number');
    expect(typeof newTimestamp).toBe('number');
  });

  test('getOrCreateElement is a function and returns an index', () => {
    expect(typeof getOrCreateElement).toBe('function');

    const session = createSession(testDevice, testApp);

    const idx = getOrCreateElement(session, {
      testId: 'submit-btn',
      type: 'button',
    });

    expect(idx).toBe(0);
    expect(session.elements).toHaveLength(1);
    expect(session.elements[0].testId).toBe('submit-btn');
  });

  test('getOrCreateElement deduplicates by testId', () => {
    const session = createSession(testDevice, testApp);

    const idx1 = getOrCreateElement(session, { testId: 'btn', type: 'button' });
    const idx2 = getOrCreateElement(session, { testId: 'btn', type: 'button' });

    expect(idx1).toBe(idx2);
    expect(session.elements).toHaveLength(1);
  });
});

// ============================================================================
// EventTypeEnum
// ============================================================================

describe('EventTypeEnum', () => {
  test('TAP is 0', () => {
    expect(EventTypeEnum.TAP).toBe(0);
  });

  test('DOUBLE_TAP is 1', () => {
    expect(EventTypeEnum.DOUBLE_TAP).toBe(1);
  });

  test('LONG_PRESS is 2', () => {
    expect(EventTypeEnum.LONG_PRESS).toBe(2);
  });

  test('SWIPE is 3', () => {
    expect(EventTypeEnum.SWIPE).toBe(3);
  });

  test('SCROLL is 4', () => {
    expect(EventTypeEnum.SCROLL).toBe(4);
  });

  test('INPUT is 5', () => {
    expect(EventTypeEnum.INPUT).toBe(5);
  });

  test('NAVIGATION is 6', () => {
    expect(EventTypeEnum.NAVIGATION).toBe(6);
  });

  test('NETWORK is 7', () => {
    expect(EventTypeEnum.NETWORK).toBe(7);
  });

  test('SCREEN_CAPTURE is 8', () => {
    expect(EventTypeEnum.SCREEN_CAPTURE).toBe(8);
  });

  test('ERROR is 9', () => {
    expect(EventTypeEnum.ERROR).toBe(9);
  });

  test('APP_STATE is 10', () => {
    expect(EventTypeEnum.APP_STATE).toBe(10);
  });

  test('has exactly 11 members', () => {
    // EventTypeEnum is a numeric enum; count numeric keys
    const numericKeys = Object.keys(EventTypeEnum).filter(k => !isNaN(Number(k)));
    expect(numericKeys).toHaveLength(11);
  });
});

// ============================================================================
// Class exports
// ============================================================================

describe('class exports', () => {
  test('EventBatcher is a constructor', () => {
    expect(typeof EventBatcher).toBe('function');
  });

  test('BaseRecorder is a constructor', () => {
    expect(typeof BaseRecorder).toBe('function');
  });

  test('NetworkInterceptor is a constructor', () => {
    expect(typeof NetworkInterceptor).toBe('function');
  });

  test('sanitizeUrl is a function', () => {
    expect(typeof sanitizeUrl).toBe('function');
  });

  test('shouldIgnoreUrl is a function', () => {
    expect(typeof shouldIgnoreUrl).toBe('function');
  });
});
