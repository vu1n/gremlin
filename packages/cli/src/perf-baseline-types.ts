/**
 * Perf baseline types and I/O helpers.
 *
 * Shared contract consumed by perf-baseline, generate --perf, and run --perf.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface MetricBudget {
  p50: number;
  p75: number;
  p95: number;
  budget: number;
}

export interface FlowBudgets {
  totalDuration: { p75: number; budget: number };
  maxLongTaskDuration: { p75: number; budget: number };
  avgFps: { p75: number; budget: number };
}

export interface PerfBaselineFlow {
  name: string;
  pattern: string[];
  sessionCount: number;
  budgets: FlowBudgets;
}

export interface PerfBaseline {
  version: 1;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  margin: number;
  global: {
    lcp: MetricBudget;
    cls: MetricBudget;
    inp: MetricBudget;
    fcp: MetricBudget;
    ttfb: MetricBudget;
  };
  flows: PerfBaselineFlow[];
}

// ============================================================================
// I/O Helpers
// ============================================================================

const DEFAULT_PATH = '.gremlin/perf-baseline.json';

export function readBaseline(path?: string): PerfBaseline | null {
  const p = path ?? DEFAULT_PATH;
  if (!existsSync(p)) return null;
  try {
    const content = readFileSync(p, 'utf-8');
    return JSON.parse(content) as PerfBaseline;
  } catch {
    return null;
  }
}

export function writeBaseline(baseline: PerfBaseline, path?: string): void {
  const p = path ?? DEFAULT_PATH;
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}
