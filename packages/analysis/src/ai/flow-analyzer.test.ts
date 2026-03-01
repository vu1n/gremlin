import { describe, test, expect } from 'bun:test';
import { formatEvent, formatSessionsForPrompt } from './flow-analyzer.ts';
import type { GremlinSession } from '@gremlin/session';

function makeSession(overrides?: Partial<GremlinSession>): GremlinSession {
  return {
    header: {
      sessionId: 'test-1',
      startTime: Date.now(),
      schemaVersion: 1,
      device: { platform: 'web', osVersion: 'macOS 14', screen: { width: 1920, height: 1080, pixelRatio: 2 } },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'https://test.com' },
    },
    elements: [
      { testId: 'submit-btn', type: 'button', text: 'Submit' },
    ],
    events: [],
    screenshots: [],
    ...overrides,
  } as GremlinSession;
}

function makeTapEvent(opts?: { perf?: any; elementIndex?: number }) {
  return {
    dt: 1000,
    type: 0,
    data: { kind: 'tap' as const, x: 100, y: 200, elementIndex: opts?.elementIndex ?? 0 },
    perf: opts?.perf,
  };
}

describe('formatEvent()', () => {
  test('appends [perf: fps=X, lag=Xms, longTasks=X] suffix when event has perf data', () => {
    const session = makeSession();
    const event = makeTapEvent({
      perf: { fps: 30, jsThreadLag: 120, longTaskCount: 2 },
    });

    const result = formatEvent(session, event as any, 1000);

    expect(result).toContain('[perf: fps=30, lag=120ms, longTasks=2]');
  });

  test('omits perf suffix when no perf data present', () => {
    const session = makeSession();
    const event = makeTapEvent({ perf: undefined });

    const result = formatEvent(session, event as any, 1000);

    expect(result).not.toContain('[perf:');
  });

  test('only shows lag when > 50ms', () => {
    const session = makeSession();

    // lag = 30ms (should be omitted)
    const event1 = makeTapEvent({
      perf: { fps: 60, jsThreadLag: 30, longTaskCount: 0 },
    });
    const result1 = formatEvent(session, event1 as any, 1000);
    expect(result1).not.toContain('lag=');

    // lag = 80ms (should be included)
    const event2 = makeTapEvent({
      perf: { fps: 60, jsThreadLag: 80, longTaskCount: 0 },
    });
    const result2 = formatEvent(session, event2 as any, 1000);
    expect(result2).toContain('lag=80ms');
  });

  test('only shows longTasks when > 0', () => {
    const session = makeSession();

    // longTaskCount = 0 (should be omitted)
    const event1 = makeTapEvent({
      perf: { fps: 60, longTaskCount: 0 },
    });
    const result1 = formatEvent(session, event1 as any, 1000);
    expect(result1).not.toContain('longTasks=');

    // longTaskCount = 3 (should be included)
    const event2 = makeTapEvent({
      perf: { fps: 60, longTaskCount: 3 },
    });
    const result2 = formatEvent(session, event2 as any, 1000);
    expect(result2).toContain('longTasks=3');
  });

  test('shows fps even when lag and longTasks are absent', () => {
    const session = makeSession();
    const event = makeTapEvent({
      perf: { fps: 55 },
    });

    const result = formatEvent(session, event as any, 1000);
    expect(result).toContain('[perf: fps=55]');
  });
});

describe('formatSessionsForPrompt()', () => {
  test('includes "Performance: LCP=Xms, ..." line when session.performance exists', () => {
    const session = makeSession({
      performance: {
        webVitals: { lcp: 1200, cls: 0.05, inp: 80 },
        avgFps: 58,
        longTaskCount: 4,
        peakMemoryUsage: 120,
      },
    });

    const result = formatSessionsForPrompt([session]);

    expect(result).toContain('Performance:');
    expect(result).toContain('LCP=1200ms');
    expect(result).toContain('CLS=0.05');
    expect(result).toContain('INP=80ms');
    expect(result).toContain('avgFPS=58');
    expect(result).toContain('longTasks=4');
    expect(result).toContain('peakMem=120MB');
  });

  test('omits performance line when session.performance is undefined', () => {
    const session = makeSession({ performance: undefined });

    const result = formatSessionsForPrompt([session]);

    expect(result).not.toContain('Performance:');
  });

  test('omits performance line when session.performance has no metrics', () => {
    const session = makeSession({ performance: {} });

    const result = formatSessionsForPrompt([session]);

    // Empty performance = no parts = no line
    expect(result).not.toContain('Performance:');
  });

  test('includes per-event perf annotations in output', () => {
    const session = makeSession({
      events: [
        makeTapEvent({ perf: { fps: 45, jsThreadLag: 100, longTaskCount: 1 } }) as any,
      ],
    });

    const result = formatSessionsForPrompt([session]);

    expect(result).toContain('[perf: fps=45, lag=100ms, longTasks=1]');
  });

  test('includes webVitals fields selectively (only defined ones)', () => {
    const session = makeSession({
      performance: {
        webVitals: { lcp: 800, fcp: 400 },
      },
    });

    const result = formatSessionsForPrompt([session]);

    expect(result).toContain('LCP=800ms');
    expect(result).toContain('FCP=400ms');
    expect(result).not.toContain('CLS=');
    expect(result).not.toContain('INP=');
    expect(result).not.toContain('TTFB=');
  });
});
