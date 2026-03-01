import { describe, test, expect } from 'bun:test';
import { toAnalysisBaseline } from '../baseline.ts';
import type { PerfBaseline } from '../../../perf-baseline-types.ts';
import type { GremlinSession } from '@gremlin/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetricBudget(p75: number) {
  return { p50: p75 * 0.7, p75, p95: p75 * 1.3, budget: p75 * 1.5 };
}

function makeBaseline(overrides?: Partial<PerfBaseline>): PerfBaseline {
  return {
    version: 1,
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-02T00:00:00Z',
    sessionCount: 10,
    margin: 0.2,
    global: {
      lcp: makeMetricBudget(2500),
      fcp: makeMetricBudget(1800),
      cls: makeMetricBudget(0.1),
      inp: makeMetricBudget(200),
      ttfb: makeMetricBudget(800),
    },
    flows: [],
    ...overrides,
  };
}

function makeSession(sessionId: string): GremlinSession {
  return {
    header: {
      sessionId,
      startTime: Date.now(),
      schemaVersion: 1,
      device: { platform: 'web', osVersion: 'macOS 14', screen: { width: 1920, height: 1080, pixelRatio: 2 } },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'https://test.com' },
    },
    elements: [],
    events: [],
    screenshots: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toAnalysisBaseline', () => {
  test('converts global metrics to webVitals wrapper', () => {
    const baseline = makeBaseline();
    const result = toAnalysisBaseline(baseline, []);

    expect(result.version).toBe(1);
    expect(result.createdAt).toBe(baseline.createdAt);
    expect(result.updatedAt).toBe(baseline.updatedAt);
    expect(result.sessionCount).toBe(baseline.sessionCount);
    expect(result.global.webVitals.lcp).toEqual(baseline.global.lcp);
    expect(result.global.webVitals.fcp).toEqual(baseline.global.fcp);
    expect(result.global.webVitals.cls).toEqual(baseline.global.cls);
    expect(result.global.webVitals.inp).toEqual(baseline.global.inp);
    expect(result.global.webVitals.ttfb).toEqual(baseline.global.ttfb);
  });

  test('includes default longTasks in global', () => {
    const baseline = makeBaseline();
    const result = toAnalysisBaseline(baseline, []);

    expect(result.global.longTasks).toBeDefined();
    expect(result.global.longTasks.count.budget).toBe(10);
    expect(result.global.longTasks.totalDuration.budget).toBe(5000);
  });

  test('converts flows with navigate pattern steps', () => {
    const baseline = makeBaseline({
      flows: [
        {
          name: 'checkout',
          pattern: ['navigate:home', 'navigate:cart', 'navigate:checkout'],
          sessionCount: 3,
          budgets: {
            totalDuration: { p75: 5000, budget: 7500 },
            maxLongTaskDuration: { p75: 200, budget: 300 },
            avgFps: { p75: 55, budget: 45 },
          },
        },
      ],
    });

    const result = toAnalysisBaseline(baseline, []);
    const flow = result.flows['checkout'];
    expect(flow).toBeDefined();
    expect(flow.steps).toHaveLength(3);
    expect(flow.steps[0]).toEqual({ type: 'navigation', screen: 'home', url: '/home' });
    expect(flow.steps[1]).toEqual({ type: 'navigation', screen: 'cart', url: '/cart' });
    expect(flow.duration.p75).toBe(5000);
    expect(flow.duration.budget).toBe(7500);
    expect(flow.longTasks.totalDuration.p75).toBe(200);
    expect(flow.longTasks.totalDuration.budget).toBe(300);
  });

  test('converts flows with tap pattern steps', () => {
    const baseline = makeBaseline({
      flows: [
        {
          name: 'login',
          pattern: ['tap:submit-button'],
          sessionCount: 1,
          budgets: {
            totalDuration: { p75: 1000, budget: 1500 },
            maxLongTaskDuration: { p75: 100, budget: 200 },
            avgFps: { p75: 60, budget: 50 },
          },
        },
      ],
    });

    const result = toAnalysisBaseline(baseline, []);
    const flow = result.flows['login'];
    expect(flow.steps[0]).toEqual({ type: 'tap', target: 'submit-button' });
  });

  test('uses flow sessionIds when available', () => {
    const baseline = makeBaseline({
      flows: [
        {
          name: 'flow1',
          pattern: ['navigate:home'],
          sessionCount: 2,
          sessionIds: ['id-a', 'id-b'],
          budgets: {
            totalDuration: { p75: 1000, budget: 1500 },
            maxLongTaskDuration: { p75: 100, budget: 200 },
            avgFps: { p75: 60, budget: 50 },
          },
        },
      ],
    });

    const result = toAnalysisBaseline(baseline, [makeSession('id-x'), makeSession('id-y')]);
    const flow = result.flows['flow1'];
    expect(flow.sessionIds).toEqual(['id-a', 'id-b']);
  });

  test('falls back to session list when sessionIds are absent', () => {
    const baseline = makeBaseline({
      flows: [
        {
          name: 'flow1',
          pattern: ['navigate:home'],
          sessionCount: 2,
          budgets: {
            totalDuration: { p75: 1000, budget: 1500 },
            maxLongTaskDuration: { p75: 100, budget: 200 },
            avgFps: { p75: 60, budget: 50 },
          },
        },
      ],
    });

    const sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')];
    const result = toAnalysisBaseline(baseline, sessions);
    const flow = result.flows['flow1'];
    // Should take first 2 (sessionCount=2) from session list
    expect(flow.sessionIds).toEqual(['s1', 's2']);
  });

  test('handles empty flows array', () => {
    const baseline = makeBaseline({ flows: [] });
    const result = toAnalysisBaseline(baseline, []);
    expect(result.flows).toEqual({});
  });
});
