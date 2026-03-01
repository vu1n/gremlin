/**
 * Schema Version Compatibility Tests
 *
 * Covers:
 * - SCHEMA_VERSION is a positive integer
 * - SDK_VERSION matches expected semver format
 * - Session created with createSession has correct schemaVersion
 * - JSON round-trip preserves schemaVersion
 */

import { describe, test, expect } from 'bun:test';
import { SCHEMA_VERSION, SDK_VERSION } from '../constants.ts';
import { createSession } from '../builders.ts';
import type { DeviceInfo, AppInfo, GremlinSession } from '../types.ts';

// ============================================================================
// Helpers
// ============================================================================

const testDevice: DeviceInfo = {
  platform: 'web',
  osVersion: '17.0',
  screen: { width: 1440, height: 900, pixelRatio: 2 },
};

const testApp: AppInfo = {
  name: 'schema-test-app',
  version: '2.0.0',
  identifier: 'com.test.schema',
};

// ============================================================================
// SCHEMA_VERSION
// ============================================================================

describe('SCHEMA_VERSION', () => {
  test('is a positive integer', () => {
    expect(typeof SCHEMA_VERSION).toBe('number');
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  test('current value is 1', () => {
    // This test documents the current schema version.
    // Update this when schema version is bumped intentionally.
    expect(SCHEMA_VERSION).toBe(1);
  });
});

// ============================================================================
// SDK_VERSION
// ============================================================================

describe('SDK_VERSION', () => {
  test('is a non-empty string', () => {
    expect(typeof SDK_VERSION).toBe('string');
    expect(SDK_VERSION.length).toBeGreaterThan(0);
  });

  test('matches semver-like format (x.y.z)', () => {
    // Accept standard semver and pre-release tags
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('current value is 0.0.1', () => {
    expect(SDK_VERSION).toBe('0.0.1');
  });
});

// ============================================================================
// Session schemaVersion integration
// ============================================================================

describe('createSession schemaVersion', () => {
  test('session header includes schemaVersion matching SCHEMA_VERSION', () => {
    const session = createSession(testDevice, testApp);

    expect(session.header.schemaVersion).toBe(SCHEMA_VERSION);
  });

  test('schemaVersion is a number on the created session', () => {
    const session = createSession(testDevice, testApp);

    expect(typeof session.header.schemaVersion).toBe('number');
  });
});

// ============================================================================
// JSON round-trip
// ============================================================================

describe('JSON round-trip preserves schemaVersion', () => {
  test('schemaVersion survives JSON.stringify -> JSON.parse', () => {
    const session = createSession(testDevice, testApp);
    const json = JSON.stringify(session);
    const parsed = JSON.parse(json) as GremlinSession;

    expect(parsed.header.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof parsed.header.schemaVersion).toBe('number');
  });

  test('full session structure round-trips cleanly', () => {
    const session = createSession(testDevice, testApp);
    const json = JSON.stringify(session);
    const parsed = JSON.parse(json) as GremlinSession;

    expect(parsed.header.sessionId).toBe(session.header.sessionId);
    expect(parsed.header.startTime).toBe(session.header.startTime);
    expect(parsed.header.device).toEqual(session.header.device);
    expect(parsed.header.app).toEqual(session.header.app);
    expect(parsed.elements).toEqual(session.elements);
    expect(parsed.events).toEqual(session.events);
    expect(parsed.screenshots).toEqual(session.screenshots);
  });

  test('schemaVersion is preserved as integer (not float) after round-trip', () => {
    const session = createSession(testDevice, testApp);
    const json = JSON.stringify(session);
    const parsed = JSON.parse(json) as GremlinSession;

    expect(Number.isInteger(parsed.header.schemaVersion)).toBe(true);
  });
});
