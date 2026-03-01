/**
 * perf-baseline command — snapshot current performance metrics as a baseline
 * for regression testing.
 *
 * Reads sessions, computes p50/p75/p95 for Web Vitals, derives budgets
 * (p75 * margin), extracts flow patterns from navigation events, and writes
 * `.gremlin/perf-baseline.json`.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  GremlinSession,
  SessionPerformance,
  GremlinEvent,
} from '@gremlin/session';
import { output, outputError, type OutputOptions } from '../output.ts';
import type {
  PerfBaseline,
  PerfBaselineFlow,
  MetricBudget,
  FlowBudgets,
} from '../perf-baseline-types.ts';
import { readBaseline, writeBaseline } from '../perf-baseline-types.ts';
import { percentile } from '../stats.ts';

interface PerfBaselineOptions extends OutputOptions {
  input?: string;
  margin?: number;
  update?: boolean;
}

interface PerfBaselineResult {
  path: string;
  sessionCount: number;
  flowCount: number;
  margin: number;
  baseline: PerfBaseline;
}

function computeMetricBudget(
  values: number[],
  margin: number
): MetricBudget | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p95 = percentile(sorted, 95);
  return { p50, p75, p95, budget: Math.round(p75 * margin * 1000) / 1000 };
}

/**
 * Build a normalised pattern string for a navigation event:
 *   "navigate:<screen>" or "tap:<testId|text>"
 */
function eventToPatternStep(event: GremlinEvent, session: GremlinSession): string | null {
  const d = event.data as unknown as Record<string, unknown>;
  if (d.kind === 'navigation') {
    return `navigate:${(d.screen as string) ?? 'unknown'}`;
  }
  if (d.kind === 'tap' || d.kind === 'double_tap' || d.kind === 'long_press') {
    const elemIdx = d.elementIndex as number | undefined;
    if (elemIdx !== undefined && session.elements[elemIdx]) {
      const el = session.elements[elemIdx];
      const label = el.testId ?? el.accessibilityLabel ?? el.text ?? 'unknown';
      return `tap:${label}`;
    }
    return null; // tap without identifiable element — skip
  }
  return null;
}

interface FlowData {
  pattern: string[];
  durations: number[];
  longTaskDurations: number[];
  fpsValues: number[];
}

function extractFlows(sessions: { session: GremlinSession; perf: SessionPerformance }[]): Map<string, FlowData> {
  const flows = new Map<string, FlowData>();

  for (const { session, perf } of sessions) {
    const steps: string[] = [];

    for (const event of session.events) {
      const step = eventToPatternStep(event, session);
      if (step) steps.push(step);
    }

    if (steps.length < 2) continue;

    const key = steps.join(' -> ');
    let flow = flows.get(key);
    if (!flow) {
      flow = { pattern: steps, durations: [], longTaskDurations: [], fpsValues: [] };
      flows.set(key, flow);
    }

    // Session-level duration from header
    const duration =
      (session.header.endTime ?? session.header.startTime) -
      session.header.startTime;
    flow.durations.push(duration);

    if (perf.longTaskTotalDuration !== undefined)
      flow.longTaskDurations.push(perf.longTaskTotalDuration);
    if (perf.avgFps !== undefined) flow.fpsValues.push(perf.avgFps);
  }

  return flows;
}

function buildFlowBaselines(
  flows: Map<string, FlowData>,
  margin: number
): PerfBaselineFlow[] {
  const result: PerfBaselineFlow[] = [];

  for (const [, flow] of flows) {
    if (flow.durations.length < 2) continue; // Need at least 2 sessions per flow

    const sortedDuration = [...flow.durations].sort((a, b) => a - b);
    const sortedLongTask = [...flow.longTaskDurations].sort((a, b) => a - b);
    const sortedFps = [...flow.fpsValues].sort((a, b) => a - b);

    const durationP75 = percentile(sortedDuration, 75);
    const longTaskP75 =
      sortedLongTask.length > 0 ? percentile(sortedLongTask, 75) : 0;
    const fpsP75 = sortedFps.length > 0 ? percentile(sortedFps, 75) : 60;

    // Name from first and last navigation steps
    const navSteps = flow.pattern.filter((s) => s.startsWith('navigate:'));
    const name =
      navSteps.length >= 2
        ? `${navSteps[0].replace('navigate:', '')}-to-${navSteps[navSteps.length - 1].replace('navigate:', '')}`
        : flow.pattern.slice(0, 3).join('-').replace(/:/g, '_');

    const budgets: FlowBudgets = {
      totalDuration: {
        p75: durationP75,
        budget: Math.round(durationP75 * margin),
      },
      maxLongTaskDuration: {
        p75: longTaskP75,
        budget: Math.round(longTaskP75 * margin),
      },
      // For FPS, lower is worse, so budget = p75 / margin (floor)
      avgFps: {
        p75: fpsP75,
        budget: Math.round(fpsP75 / margin),
      },
    };

    result.push({
      name,
      pattern: flow.pattern,
      sessionCount: flow.durations.length,
      budgets,
    });
  }

  // Sort by session count descending (most common flows first)
  result.sort((a, b) => b.sessionCount - a.sessionCount);
  return result;
}

function mergeBaseline(
  existing: PerfBaseline,
  incoming: PerfBaseline
): PerfBaseline {
  // Keep tighter (lower) budgets for global vitals
  const mergedGlobal = { ...incoming.global };
  for (const key of ['lcp', 'cls', 'inp', 'fcp', 'ttfb'] as const) {
    const ex = existing.global[key];
    const inc = mergedGlobal[key];
    if (ex && inc) {
      mergedGlobal[key] = {
        ...inc,
        budget: Math.min(ex.budget, inc.budget),
      };
    }
  }

  // Merge flows: keep tighter budgets for matching patterns
  const existingFlowMap = new Map(
    existing.flows.map((f) => [f.pattern.join(' -> '), f])
  );
  const mergedFlows: PerfBaselineFlow[] = [];

  for (const flow of incoming.flows) {
    const key = flow.pattern.join(' -> ');
    const existingFlow = existingFlowMap.get(key);
    if (existingFlow) {
      mergedFlows.push({
        ...flow,
        budgets: {
          totalDuration: {
            ...flow.budgets.totalDuration,
            budget: Math.min(
              existingFlow.budgets.totalDuration.budget,
              flow.budgets.totalDuration.budget
            ),
          },
          maxLongTaskDuration: {
            ...flow.budgets.maxLongTaskDuration,
            budget: Math.min(
              existingFlow.budgets.maxLongTaskDuration.budget,
              flow.budgets.maxLongTaskDuration.budget
            ),
          },
          // For FPS, higher budget is tighter (more demanding)
          avgFps: {
            ...flow.budgets.avgFps,
            budget: Math.max(
              existingFlow.budgets.avgFps.budget,
              flow.budgets.avgFps.budget
            ),
          },
        },
      });
      existingFlowMap.delete(key);
    } else {
      mergedFlows.push(flow);
    }
  }

  // Keep existing flows not found in incoming
  for (const [, flow] of existingFlowMap) {
    mergedFlows.push(flow);
  }

  return {
    ...incoming,
    updatedAt: new Date().toISOString(),
    global: mergedGlobal,
    flows: mergedFlows,
  };
}

function loadSessionsWithPerf(
  input: string
): { sessionsWithPerf: { session: GremlinSession; perf: SessionPerformance }[]; totalLoaded: number; warnings: string[] } {
  const files = readdirSync(input).filter((f) => f.endsWith('.json'));
  const sessionsWithPerf: { session: GremlinSession; perf: SessionPerformance }[] = [];
  const warnings: string[] = [];
  let totalLoaded = 0;

  for (const file of files) {
    try {
      const content = readFileSync(join(input, file), 'utf-8');
      const session = JSON.parse(content) as GremlinSession;
      totalLoaded++;
      if (session.performance) {
        sessionsWithPerf.push({ session, perf: session.performance });
      }
    } catch {
      warnings.push(`Skipped unreadable file: ${file}`);
    }
  }

  return { sessionsWithPerf, totalLoaded, warnings };
}

function collectWebVitalValues(
  sessionsWithPerf: { perf: SessionPerformance }[]
): { lcp: number[]; cls: number[]; inp: number[]; fcp: number[]; ttfb: number[] } {
  const lcp: number[] = [];
  const cls: number[] = [];
  const inp: number[] = [];
  const fcp: number[] = [];
  const ttfb: number[] = [];

  for (const { perf } of sessionsWithPerf) {
    if (perf.webVitals?.lcp !== undefined) lcp.push(perf.webVitals.lcp);
    if (perf.webVitals?.cls !== undefined) cls.push(perf.webVitals.cls);
    if (perf.webVitals?.inp !== undefined) inp.push(perf.webVitals.inp);
    if (perf.webVitals?.fcp !== undefined) fcp.push(perf.webVitals.fcp);
    if (perf.webVitals?.ttfb !== undefined) ttfb.push(perf.webVitals.ttfb);
  }

  return { lcp, cls, inp, fcp, ttfb };
}

function buildGlobalBudgets(
  vitals: { lcp: number[]; cls: number[]; inp: number[]; fcp: number[]; ttfb: number[] },
  margin: number
): PerfBaseline['global'] {
  const zeroBudget: MetricBudget = { p50: 0, p75: 0, p95: 0, budget: 0 };
  return {
    lcp: computeMetricBudget(vitals.lcp, margin) ?? zeroBudget,
    cls: computeMetricBudget(vitals.cls, margin) ?? zeroBudget,
    inp: computeMetricBudget(vitals.inp, margin) ?? zeroBudget,
    fcp: computeMetricBudget(vitals.fcp, margin) ?? zeroBudget,
    ttfb: computeMetricBudget(vitals.ttfb, margin) ?? zeroBudget,
  };
}

function printBaselineResult(
  baseline: PerfBaseline,
  baselinePath: string,
  margin: number,
  flows: PerfBaselineFlow[],
  isUpdate: boolean,
  warnings: string[]
): void {
  console.log('');
  console.log('Performance Baseline');
  console.log('====================');
  console.log('');
  console.log(`Sessions:  ${baseline.sessionCount}`);
  console.log(`Margin:    ${margin}x (${((margin - 1) * 100).toFixed(0)}% headroom above p75)`);
  console.log(`Output:    ${baselinePath}`);
  console.log('');

  console.log('Global Web Vitals Budgets:');
  console.log(
    `  ${'Metric'.padEnd(8)} ${'p50'.padEnd(10)} ${'p75'.padEnd(10)} ${'p95'.padEnd(10)} Budget`
  );
  console.log(
    `  ${'------'.padEnd(8)} ${'---'.padEnd(10)} ${'---'.padEnd(10)} ${'---'.padEnd(10)} ------`
  );

  const vitals: [string, MetricBudget, string][] = [
    ['LCP', baseline.global.lcp, 'ms'],
    ['CLS', baseline.global.cls, ''],
    ['INP', baseline.global.inp, 'ms'],
    ['FCP', baseline.global.fcp, 'ms'],
    ['TTFB', baseline.global.ttfb, 'ms'],
  ];

  for (const [name, data, unit] of vitals) {
    if (data.p75 === 0 && data.p50 === 0) continue;
    const fmt = (v: number) => (unit === 'ms' ? `${v.toFixed(0)}ms` : v.toFixed(3));
    console.log(
      `  ${name.padEnd(8)} ${fmt(data.p50).padEnd(10)} ${fmt(data.p75).padEnd(10)} ${fmt(data.p95).padEnd(10)} ${fmt(data.budget)}`
    );
  }

  if (flows.length > 0) {
    console.log('');
    console.log(`Flows (${flows.length}):`);
    for (const flow of flows) {
      console.log(
        `  ${flow.name} (${flow.sessionCount} sessions) — duration budget: ${flow.budgets.totalDuration.budget}ms`
      );
    }
  }

  if (isUpdate) {
    console.log('');
    console.log('(Merged with existing baseline — tighter budgets kept)');
  }

  console.log('');

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`  warn: ${w}`);
    }
  }
}

export function perfBaseline(
  options: PerfBaselineOptions
): PerfBaselineResult | null {
  const input = options.input ?? '.gremlin/sessions';
  const margin = options.margin ?? 1.4;
  const baselinePath = '.gremlin/perf-baseline.json';

  // Validate input directory
  if (!existsSync(input)) {
    if (
      outputError('perf-baseline', ['Sessions directory not found: ' + input], options)
    )
      return null;
    console.error(`Sessions directory not found: ${input}`);
    console.error('Run your app with `gremlin dev` to collect sessions first.');
    return null;
  }

  const files = readdirSync(input).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    if (outputError('perf-baseline', ['No session files found in ' + input], options))
      return null;
    console.error(`No session files found in ${input}`);
    return null;
  }

  const { sessionsWithPerf, totalLoaded, warnings } = loadSessionsWithPerf(input);

  if (sessionsWithPerf.length === 0) {
    if (
      outputError(
        'perf-baseline',
        [`Found ${totalLoaded} sessions but none have performance data`],
        options
      )
    )
      return null;
    console.error(
      `Found ${totalLoaded} sessions but none have performance data.`
    );
    return null;
  }

  const vitalValues = collectWebVitalValues(sessionsWithPerf);
  const global = buildGlobalBudgets(vitalValues, margin);

  const flowMap = extractFlows(sessionsWithPerf);
  const flows = buildFlowBaselines(flowMap, margin);

  const now = new Date().toISOString();
  let baseline: PerfBaseline = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    sessionCount: sessionsWithPerf.length,
    margin,
    global,
    flows,
  };

  // Merge with existing baseline if --update
  if (options.update) {
    const existing = readBaseline(baselinePath);
    if (existing) {
      baseline = mergeBaseline(existing, baseline);
      baseline.createdAt = existing.createdAt;
    }
  }

  writeBaseline(baseline, baselinePath);

  const result: PerfBaselineResult = {
    path: baselinePath,
    sessionCount: baseline.sessionCount,
    flowCount: baseline.flows.length,
    margin,
    baseline,
  };

  if (
    output('perf-baseline', result, options, {
      warnings: warnings.length > 0 ? warnings : undefined,
    })
  )
    return result;

  printBaselineResult(baseline, baselinePath, margin, flows, !!options.update, warnings);

  return result;
}
