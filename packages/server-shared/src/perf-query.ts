import type { SessionSummary, SessionListResult } from './types.ts';
import type { PerfSortKey, PerfQueryOptions } from './perf-types.ts';
import type { PerformanceAggregation } from './routes.ts';
import { aggregateMetric } from './stats.ts';

export function getPerfValue(s: SessionSummary, key: PerfSortKey): number | undefined {
  const p = s.performance;
  switch (key) {
    case 'lcp': return p?.webVitals?.lcp;
    case 'cls': return p?.webVitals?.cls;
    case 'inp': return p?.webVitals?.inp;
    case 'fcp': return p?.webVitals?.fcp;
    case 'ttfb': return p?.webVitals?.ttfb;
    case 'avgFps': return p?.avgFps;
    case 'minFps': return p?.minFps;
    case 'longTasks': return p?.longTaskCount;
    case 'peakMemory': return p?.peakMemoryUsage;
    case 'pageLoad': return p?.pageLoadTime;
    case 'duration': return s.duration;
    case 'eventCount': return s.eventCount;
    case 'startTime': return s.startTime;
  }
}

export function filterSortPaginate(
  summaries: SessionSummary[],
  opts: PerfQueryOptions
): SessionListResult {
  let filtered = summaries;

  if (opts.filters && opts.filters.length > 0) {
    filtered = filtered.filter((s) =>
      opts.filters!.every((f) => {
        const val = getPerfValue(s, f.key);
        if (val === undefined) return false;
        return f.op === 'gt' ? val > f.value : val < f.value;
      })
    );
  }

  const sortKey = opts.sort ?? 'startTime';
  const desc = (opts.order ?? 'desc') === 'desc';

  filtered.sort((a, b) => {
    const va = getPerfValue(a, sortKey);
    const vb = getPerfValue(b, sortKey);
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return desc ? vb - va : va - vb;
  });

  const limit = opts.limit ?? 20;
  let startIndex = 0;
  if (opts.cursor) {
    const cursorIndex = filtered.findIndex((s) => s.id === opts.cursor);
    if (cursorIndex >= 0) startIndex = cursorIndex + 1;
  }

  const page = filtered.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < filtered.length && page.length > 0
      ? page[page.length - 1].id
      : undefined;

  return {
    sessions: page,
    cursor: nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: filtered.length,
  };
}

export function computePerformanceAggregation(
  summaries: SessionSummary[]
): PerformanceAggregation {
  const lcpVals: number[] = [];
  const clsVals: number[] = [];
  const inpVals: number[] = [];
  const fcpVals: number[] = [];
  const ttfbVals: number[] = [];
  const avgFpsVals: number[] = [];
  const minFpsVals: number[] = [];
  let longTaskTotal = 0;
  let longTaskDuration = 0;
  let longTaskSessions = 0;
  const peakMemVals: number[] = [];
  const pageLoadVals: number[] = [];
  let sessionsWithPerf = 0;

  for (const s of summaries) {
    const p = s.performance;
    if (!p) continue;
    sessionsWithPerf++;

    if (p.webVitals?.lcp !== undefined) lcpVals.push(p.webVitals.lcp);
    if (p.webVitals?.cls !== undefined) clsVals.push(p.webVitals.cls);
    if (p.webVitals?.inp !== undefined) inpVals.push(p.webVitals.inp);
    if (p.webVitals?.fcp !== undefined) fcpVals.push(p.webVitals.fcp);
    if (p.webVitals?.ttfb !== undefined) ttfbVals.push(p.webVitals.ttfb);
    if (p.avgFps !== undefined) avgFpsVals.push(p.avgFps);
    if (p.minFps !== undefined) minFpsVals.push(p.minFps);
    if (p.longTaskCount !== undefined) {
      longTaskTotal += p.longTaskCount;
      longTaskDuration += p.longTaskTotalDuration ?? 0;
      longTaskSessions++;
    }
    if (p.peakMemoryUsage !== undefined) peakMemVals.push(p.peakMemoryUsage);
    if (p.pageLoadTime !== undefined) pageLoadVals.push(p.pageLoadTime);
  }

  return {
    sessionCount: summaries.length,
    sessionsWithPerf,
    webVitals: {
      lcp: aggregateMetric(lcpVals),
      cls: aggregateMetric(clsVals),
      inp: aggregateMetric(inpVals),
      fcp: aggregateMetric(fcpVals),
      ttfb: aggregateMetric(ttfbVals),
    },
    fps: avgFpsVals.length > 0 ? {
      avgFps: avgFpsVals.reduce((a, b) => a + b, 0) / avgFpsVals.length,
      minFps: Math.min(...minFpsVals.length > 0 ? minFpsVals : avgFpsVals),
      count: avgFpsVals.length,
    } : null,
    longTasks: longTaskSessions > 0 ? {
      totalCount: longTaskTotal,
      totalDuration: longTaskDuration,
      avgPerSession: longTaskTotal / longTaskSessions,
      count: longTaskSessions,
    } : null,
    memory: peakMemVals.length > 0 ? {
      avgPeak: peakMemVals.reduce((a, b) => a + b, 0) / peakMemVals.length,
      maxPeak: Math.max(...peakMemVals),
      count: peakMemVals.length,
    } : null,
    pageLoad: aggregateMetric(pageLoadVals),
  };
}
