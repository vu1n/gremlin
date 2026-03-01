import { describe, test, expect } from 'bun:test';
import { formatSessionsForPrompt } from '@gremlin/analysis';
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

describe('formatSessionsForPrompt() (CLI usage with truncation)', () => {
  const cliOptions = { maxSessions: 10, maxEventsPerSession: 200 };

  test('includes "Performance: LCP=Xms, ..." line when session has performance data', () => {
    const session = makeSession({
      performance: {
        webVitals: { lcp: 2500, cls: 0.1, inp: 200, fcp: 800, ttfb: 150 },
        avgFps: 55,
        minFps: 30,
        longTaskCount: 7,
        peakMemoryUsage: 200,
        pageLoadTime: 3500,
      },
    });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).toContain('Performance:');
    expect(result).toContain('LCP=2500ms');
    expect(result).toContain('CLS=0.1');
    expect(result).toContain('INP=200ms');
    expect(result).toContain('FCP=800ms');
    expect(result).toContain('TTFB=150ms');
    expect(result).toContain('avgFPS=55');
    expect(result).toContain('minFPS=30');
    expect(result).toContain('longTasks=7');
    expect(result).toContain('peakMem=200MB');
    expect(result).toContain('pageLoad=3500ms');
  });

  test('omits performance line when session.performance is undefined', () => {
    const session = makeSession({ performance: undefined });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).not.toContain('Performance:');
  });

  test('per-event perf annotations appear with fps, lag, longTasks', () => {
    const session = makeSession({
      events: [
        makeTapEvent({ perf: { fps: 42, jsThreadLag: 120, longTaskCount: 2 } }) as any,
      ],
    });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).toContain('[perf: fps=42, lag=120ms, longTasks=2]');
  });

  test('omits perf suffix when event has no perf data', () => {
    const session = makeSession({
      events: [
        makeTapEvent({ perf: undefined }) as any,
      ],
    });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).not.toContain('[perf:');
  });

  test('only shows lag when > 50ms in per-event annotations', () => {
    const session = makeSession({
      events: [
        makeTapEvent({ perf: { fps: 60, jsThreadLag: 30 } }) as any,
      ],
    });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).not.toContain('lag=');
  });

  test('only shows longTasks when > 0 in per-event annotations', () => {
    const session = makeSession({
      events: [
        makeTapEvent({ perf: { fps: 60, longTaskCount: 0 } }) as any,
      ],
    });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).not.toContain('longTasks=');
  });

  test('includes session-level perf fields selectively (only defined ones)', () => {
    const session = makeSession({
      performance: {
        webVitals: { lcp: 1000 },
        avgFps: 60,
      },
    });

    const result = formatSessionsForPrompt([session], cliOptions);

    expect(result).toContain('LCP=1000ms');
    expect(result).toContain('avgFPS=60');
    expect(result).not.toContain('CLS=');
    expect(result).not.toContain('minFPS=');
    expect(result).not.toContain('longTasks=');
    expect(result).not.toContain('peakMem=');
    expect(result).not.toContain('pageLoad=');
  });
});
