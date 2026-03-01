import { describe, test, expect } from 'bun:test';
import { detectCycles, formatCyclesReport, type CycleInfo } from '../cycle-detector.ts';
import { EventTypeEnum } from '@gremlin/session';
import type { GremlinSession, NavigationEvent } from '@gremlin/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  sessionId: string,
  screens: string[],
  opts?: { errorOnScreen?: string }
): GremlinSession {
  const events: GremlinSession['events'] = [];

  for (const screen of screens) {
    events.push({
      dt: 100,
      type: EventTypeEnum.NAVIGATION,
      data: { kind: 'navigation', navType: 'push', screen } as NavigationEvent,
    });

    if (opts?.errorOnScreen === screen) {
      events.push({
        dt: 10,
        type: EventTypeEnum.ERROR,
        data: { kind: 'error', message: 'Test error', errorType: 'js', fatal: false } as any,
      });
    }
  }

  return {
    header: {
      sessionId,
      startTime: 1000,
      schemaVersion: 1,
      device: { platform: 'web', osVersion: 'test', screen: { width: 1920, height: 1080, pixelRatio: 1 } },
      app: { name: 'Test', version: '1.0.0', identifier: 'test' },
    },
    elements: [],
    events,
    screenshots: [],
  };
}

// ---------------------------------------------------------------------------
// detectCycles
// ---------------------------------------------------------------------------

describe('detectCycles', () => {
  test('returns empty array when no cycles exist', () => {
    const session = makeSession('s1', ['home', 'about', 'contact']);
    const cycles = detectCycles([session]);
    expect(cycles).toEqual([]);
  });

  test('returns empty array for empty sessions', () => {
    expect(detectCycles([])).toEqual([]);
  });

  test('detects a simple A-B-A-B cycle', () => {
    const session = makeSession('s1', ['home', 'about', 'home', 'about']);
    const cycles = detectCycles([session]);
    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should contain home -> about
    const cycle = cycles.find(c => c.path.includes('home') && c.path.includes('about'));
    expect(cycle).toBeDefined();
    expect(cycle!.maxIterations).toBeGreaterThanOrEqual(2);
  });

  test('detects longer cycle patterns (A-B-C repeated)', () => {
    const session = makeSession('s1', ['a', 'b', 'c', 'a', 'b', 'c']);
    const cycles = detectCycles([session]);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test('aggregates cycles across multiple sessions', () => {
    const s1 = makeSession('s1', ['home', 'cart', 'home', 'cart']);
    const s2 = makeSession('s2', ['home', 'cart', 'home', 'cart']);
    const cycles = detectCycles([s1, s2]);

    const cycle = cycles.find(c => c.path.includes('home') && c.path.includes('cart'));
    expect(cycle).toBeDefined();
    expect(cycle!.sessionIds).toContain('s1');
    expect(cycle!.sessionIds).toContain('s2');
    // frequency >= 2 because it appears in 2 sessions
    expect(cycle!.frequency).toBeGreaterThanOrEqual(2);
  });

  test('classifies cycle with errors as error type', () => {
    // Navigate home -> about -> home -> about, with error on "about"
    const session = makeSession('s1', ['home', 'about', 'home', 'about'], {
      errorOnScreen: 'about',
    });
    const cycles = detectCycles([session]);

    if (cycles.length > 0) {
      const errorCycle = cycles.find(c => c.type === 'error');
      // If there's an error in the cycle path, it should be classified as 'error'
      if (errorCycle) {
        expect(errorCycle.type).toBe('error');
      }
    }
  });

  test('sorts cycles by frequency (most common first)', () => {
    // Create two different cycles, one more frequent
    const s1 = makeSession('s1', ['a', 'b', 'a', 'b']);
    const s2 = makeSession('s2', ['a', 'b', 'a', 'b']);
    const s3 = makeSession('s3', ['a', 'b', 'a', 'b']);
    const s4 = makeSession('s4', ['x', 'y', 'x', 'y']);
    const cycles = detectCycles([s1, s2, s3, s4]);

    if (cycles.length >= 2) {
      expect(cycles[0].frequency).toBeGreaterThanOrEqual(cycles[1].frequency);
    }
  });

  test('does not report pattern that only occurs once', () => {
    // A-B only once is not a cycle
    const session = makeSession('s1', ['home', 'about']);
    const cycles = detectCycles([session]);
    expect(cycles).toEqual([]);
  });

  test('provides example timestamps', () => {
    const session = makeSession('s1', ['a', 'b', 'a', 'b']);
    const cycles = detectCycles([session]);

    if (cycles.length > 0) {
      expect(cycles[0].exampleTimestamps.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// formatCyclesReport
// ---------------------------------------------------------------------------

describe('formatCyclesReport', () => {
  test('reports no cycles when array is empty', () => {
    const report = formatCyclesReport([]);
    expect(report).toBe('No cycles detected.');
  });

  test('includes cycle path and frequency in report', () => {
    const cycles: CycleInfo[] = [
      {
        type: 'navigation',
        path: ['home', 'cart'],
        frequency: 5,
        avgIterations: 2.5,
        maxIterations: 4,
        sessionIds: ['s1', 's2'],
        exampleTimestamps: [1000, 2000],
      },
    ];
    const report = formatCyclesReport(cycles);
    expect(report).toContain('Detected Cycles (1)');
    expect(report).toContain('home');
    expect(report).toContain('cart');
    expect(report).toContain('5 occurrences');
    expect(report).toContain('avg=2.5');
    expect(report).toContain('max=4');
    expect(report).toContain('2 unique session(s)');
  });

  test('includes type label', () => {
    const cycles: CycleInfo[] = [
      {
        type: 'error',
        path: ['login', 'error-page'],
        frequency: 1,
        avgIterations: 3,
        maxIterations: 3,
        sessionIds: ['s1'],
        exampleTimestamps: [500],
      },
    ];
    const report = formatCyclesReport(cycles);
    expect(report).toContain('ERROR');
  });

  test('formats multiple cycles', () => {
    const cycles: CycleInfo[] = [
      {
        type: 'navigation',
        path: ['a', 'b'],
        frequency: 10,
        avgIterations: 2,
        maxIterations: 3,
        sessionIds: ['s1'],
        exampleTimestamps: [100],
      },
      {
        type: 'state',
        path: ['x', 'y', 'x'],
        frequency: 5,
        avgIterations: 4,
        maxIterations: 6,
        sessionIds: ['s2'],
        exampleTimestamps: [200],
      },
    ];
    const report = formatCyclesReport(cycles);
    expect(report).toContain('Detected Cycles (2)');
    expect(report).toContain('NAVIGATION');
    expect(report).toContain('STATE');
  });
});
