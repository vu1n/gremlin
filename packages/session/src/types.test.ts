import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createSession,
  getOrCreateElement,
  addEvent,
  EventTypeEnum,
} from './types';
import type { DeviceInfo, AppInfo, GremlinSession } from './types';

const mockDevice: DeviceInfo = {
  platform: 'web',
  osVersion: '14.0',
  model: 'Desktop',
  screen: { width: 1920, height: 1080, pixelRatio: 2 },
};

const mockApp: AppInfo = {
  name: 'TestApp',
  version: '1.0.0',
  identifier: 'com.test.app',
};

describe('createSession', () => {
  it('creates a session with correct structure', () => {
    const session = createSession(mockDevice, mockApp);

    expect(session.header).toBeDefined();
    expect(session.elements).toEqual([]);
    expect(session.events).toEqual([]);
    expect(session.screenshots).toEqual([]);
  });

  it('sets header fields correctly', () => {
    const before = Date.now();
    const session = createSession(mockDevice, mockApp);
    const after = Date.now();

    expect(session.header.device).toEqual(mockDevice);
    expect(session.header.app).toEqual(mockApp);
    expect(session.header.schemaVersion).toBe(1);
    expect(session.header.startTime).toBeGreaterThanOrEqual(before);
    expect(session.header.startTime).toBeLessThanOrEqual(after);
    expect(session.header.endTime).toBeUndefined();
  });

  it('generates a unique sessionId', () => {
    const session1 = createSession(mockDevice, mockApp);
    const session2 = createSession(mockDevice, mockApp);

    expect(session1.header.sessionId).toBeTruthy();
    expect(session2.header.sessionId).toBeTruthy();
    expect(session1.header.sessionId).not.toBe(session2.header.sessionId);
  });

  it('generates sessionId with timestamp-random format', () => {
    const session = createSession(mockDevice, mockApp);
    const parts = session.header.sessionId.split('-');
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });
});

describe('getOrCreateElement', () => {
  let session: GremlinSession;

  beforeEach(() => {
    session = createSession(mockDevice, mockApp);
  });

  it('adds a new element and returns index 0 for first element', () => {
    const idx = getOrCreateElement(session, {
      testId: 'btn-login',
      type: 'button',
    });
    expect(idx).toBe(0);
    expect(session.elements).toHaveLength(1);
    expect(session.elements[0].testId).toBe('btn-login');
    expect(session.elements[0].type).toBe('button');
  });

  it('returns same index for duplicate element', () => {
    const idx1 = getOrCreateElement(session, {
      testId: 'btn-login',
      type: 'button',
    });
    const idx2 = getOrCreateElement(session, {
      testId: 'btn-login',
      type: 'button',
    });
    expect(idx1).toBe(idx2);
    expect(session.elements).toHaveLength(1);
  });

  it('returns different indices for different elements', () => {
    const idx1 = getOrCreateElement(session, {
      testId: 'btn-login',
      type: 'button',
    });
    const idx2 = getOrCreateElement(session, {
      testId: 'btn-signup',
      type: 'button',
    });
    expect(idx1).toBe(0);
    expect(idx2).toBe(1);
    expect(session.elements).toHaveLength(2);
  });

  it('deduplicates by first matching key (testId > accessibilityLabel > text)', () => {
    const idx1 = getOrCreateElement(session, {
      testId: 'btn-1',
      accessibilityLabel: 'Login',
      text: 'Log In',
      type: 'button',
    });

    // Same testId but different text => same element (key is testId)
    const idx2 = getOrCreateElement(session, {
      testId: 'btn-1',
      accessibilityLabel: 'Login',
      text: 'Sign In',
      type: 'button',
    });

    expect(idx1).toBe(0);
    expect(idx2).toBe(0);
  });

  it('treats same testId/label/text/type as duplicate', () => {
    const element = {
      testId: 'field-email',
      accessibilityLabel: 'Email',
      text: 'Enter email',
      type: 'input' as const,
    };

    const idx1 = getOrCreateElement(session, element);
    const idx2 = getOrCreateElement(session, element);
    expect(idx1).toBe(idx2);
    expect(session.elements).toHaveLength(1);
  });

  it('stores element fields correctly', () => {
    getOrCreateElement(session, {
      testId: 'input-email',
      accessibilityLabel: 'Email field',
      text: 'Enter email',
      type: 'input',
      cssSelector: '#email',
    });

    const el = session.elements[0];
    expect(el.testId).toBe('input-email');
    expect(el.accessibilityLabel).toBe('Email field');
    expect(el.text).toBe('Enter email');
    expect(el.type).toBe('input');
    expect(el.cssSelector).toBe('#email');
  });
});

describe('addEvent', () => {
  let session: GremlinSession;

  beforeEach(() => {
    session = createSession(mockDevice, mockApp);
  });

  it('pushes event to session events array', () => {
    addEvent(
      session,
      {
        type: EventTypeEnum.TAP,
        data: { kind: 'tap', x: 100, y: 200 },
      },
      Date.now()
    );

    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe(EventTypeEnum.TAP);
    expect(session.events[0].data).toMatchObject({ kind: 'tap', x: 100, y: 200 });
  });

  it('computes dt as difference from previousTimestamp', () => {
    const past = Date.now() - 500;
    const before = Date.now();
    addEvent(
      session,
      {
        type: EventTypeEnum.TAP,
        data: { kind: 'tap', x: 0, y: 0 },
      },
      past
    );
    const after = Date.now();

    const dt = session.events[0].dt;
    // dt should be approximately 500ms (between before-past and after-past)
    expect(dt).toBeGreaterThanOrEqual(before - past);
    expect(dt).toBeLessThanOrEqual(after - past);
  });

  it('returns the current timestamp for chaining', () => {
    const before = Date.now();
    const ts = addEvent(
      session,
      {
        type: EventTypeEnum.TAP,
        data: { kind: 'tap', x: 0, y: 0 },
      },
      before
    );
    const after = Date.now();

    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('supports chaining multiple events with correct deltas', () => {
    const start = Date.now();
    const ts1 = addEvent(
      session,
      { type: EventTypeEnum.TAP, data: { kind: 'tap', x: 0, y: 0 } },
      start
    );
    const ts2 = addEvent(
      session,
      { type: EventTypeEnum.NAVIGATION, data: { kind: 'navigation', navType: 'push', screen: 'Home' } },
      ts1
    );

    expect(session.events).toHaveLength(2);
    // Both dt values should be >= 0
    expect(session.events[0].dt).toBeGreaterThanOrEqual(0);
    expect(session.events[1].dt).toBeGreaterThanOrEqual(0);
  });
});
