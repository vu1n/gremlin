/**
 * Perf baseline types and I/O helpers.
 *
 * Shared contract consumed by perf-baseline, generate --perf, and run --perf.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { cwd } from 'process';

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

/**
 * Validate path is within project directory to prevent path traversal attacks
 */
function validatePath(path: string): void {
  const resolved = resolve(cwd(), path);

  // Ensure path is within current working directory
  if (!resolved.startsWith(resolve(cwd()))) {
    throw new Error(
      `Security error: Invalid path "${path}" (potential path traversal attack). ` +
      `Path must be within the current working directory.`
    );
  }

  // Ensure path is within .gremlin directory (defense in depth)
  const gremlinDir = resolve(cwd(), '.gremlin');
  if (!resolved.startsWith(gremlinDir)) {
    throw new Error(
      `Security error: Invalid path "${path}". ` +
      `Baseline files must be within the .gremlin directory.`
    );
  }
}

export function readBaseline(path?: string): PerfBaseline | null {
  const p = path ?? DEFAULT_PATH;

  // Validate path to prevent directory traversal
  validatePath(p);

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

  // Validate path to prevent directory traversal
  validatePath(p);

  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}
