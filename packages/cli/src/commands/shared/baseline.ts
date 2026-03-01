/**
 * Baseline format conversion.
 *
 * Converts the CLI's PerfBaseline format to the analysis package's
 * PerfBaseline format. The CLI stores global vitals at `global.lcp`,
 * while the analysis package expects `global.webVitals.lcp`.
 * Flows differ structurally as well.
 */

import type { GremlinSession } from '@gremlin/session';
import type { PerfBaseline as AnalysisPerfBaseline } from '@gremlin/analysis';
import type { PerfBaseline } from '../../perf-baseline-types.ts';

export function toAnalysisBaseline(
  baseline: PerfBaseline,
  sessions: GremlinSession[]
): AnalysisPerfBaseline {
  const flows: AnalysisPerfBaseline['flows'] = {};

  for (const flow of baseline.flows) {
    // Use real per-flow session IDs when the baseline has them;
    // fall back to slicing the full session list for older baselines.
    const sessionIds = flow.sessionIds ?? sessions
      .filter((s) => s.header?.sessionId)
      .map((s) => s.header.sessionId)
      .slice(0, flow.sessionCount);

    // Convert pattern steps to the analysis format
    const steps = flow.pattern.map((p) => {
      const [type, value] = p.split(':');
      if (type === 'navigate') {
        return { type: 'navigation', screen: value, url: `/${value}` };
      }
      return { type: 'tap', target: value };
    });

    flows[flow.name] = {
      sessionIds,
      steps,
      duration: {
        p50: 0,
        p75: flow.budgets.totalDuration.p75,
        p95: 0,
        budget: flow.budgets.totalDuration.budget,
      },
      longTasks: {
        count: { p50: 0, p75: 0, p95: 0, budget: 10 },
        totalDuration: {
          p50: 0,
          p75: flow.budgets.maxLongTaskDuration.p75,
          p95: 0,
          budget: flow.budgets.maxLongTaskDuration.budget,
        },
      },
    };
  }

  return {
    version: 1,
    createdAt: baseline.createdAt,
    updatedAt: baseline.updatedAt,
    sessionCount: baseline.sessionCount,
    global: {
      webVitals: {
        lcp: baseline.global.lcp,
        fcp: baseline.global.fcp,
        cls: baseline.global.cls,
        inp: baseline.global.inp,
        ttfb: baseline.global.ttfb,
      },
      longTasks: {
        count: { p50: 0, p75: 0, p95: 0, budget: 10 },
        totalDuration: { p50: 0, p75: 0, p95: 0, budget: 5000 },
      },
    },
    flows,
  };
}
