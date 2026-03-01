/**
 * Run command - unified test runner for generated tests
 *
 * Detects whether Playwright or Maestro tests exist and runs the appropriate runner.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { output, exitWithError, type OutputOptions } from '../output.ts';
import { readBaseline } from '../perf-baseline-types.ts';
import type { PerfBaseline, MetricBudget } from '../perf-baseline-types.ts';

interface RunOptions extends OutputOptions {
  /** Specific test file or pattern to run */
  test?: string;
  /** Run all tests */
  all?: boolean;
  /** Tests directory */
  testsDir: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Watch mode (Playwright only) */
  watch?: boolean;
  /** Update snapshots (Playwright only) */
  updateSnapshots?: boolean;
  /** Headed mode (Playwright only) */
  headed?: boolean;
  /** Device to run on (Maestro only) */
  device?: string;
}

interface RunnerResult {
  name: string;
  dir: string;
  exitCode: number;
}

interface RunResult {
  runners: RunnerResult[];
  passed: boolean;
}

interface TestRunner {
  name: string;
  dir: string;
  run: (options: RunOptions) => Promise<number>;
}

/**
 * Detect available test runners based on directory structure
 */
async function detectRunners(testsDir: string): Promise<TestRunner[]> {
  const runners: TestRunner[] = [];

  const playwrightDir = join(testsDir, 'playwright');
  const maestroDir = join(testsDir, 'maestro');

  if (existsSync(playwrightDir)) {
    try {
      const files = await readdir(playwrightDir);
      const hasTests = files.some(
        (f) => f.endsWith('.spec.ts') || f.endsWith('.test.ts')
      );
      if (hasTests) {
        runners.push({
          name: 'Playwright',
          dir: playwrightDir,
          run: runPlaywright,
        });
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }
  }

  if (existsSync(maestroDir)) {
    try {
      const files = await readdir(maestroDir);
      const hasTests = files.some(
        (f) => f.endsWith('.yaml') || f.endsWith('.yml')
      );
      if (hasTests) {
        runners.push({
          name: 'Maestro',
          dir: maestroDir,
          run: runMaestro,
        });
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }
  }

  return runners;
}

/**
 * Sanitize file path to prevent shell injection
 */
function sanitizePath(path: string): string {
  // Remove any shell metacharacters and limit length
  return path.replace(/[;&|`$(){}[\]<>*?]/g, '').slice(0, 500);
}

/**
 * Run Playwright tests
 */
function runPlaywright(options: RunOptions): Promise<number> {
  const args = ['playwright', 'test'];

  if (options.test) {
    // Sanitize test file path to prevent shell injection
    args.push(sanitizePath(options.test));
  }

  if (options.headed) {
    args.push('--headed');
  }
  if (options.watch) {
    args.push('--ui');
  }
  if (options.updateSnapshots) {
    args.push('--update-snapshots');
  }
  if (options.verbose) {
    args.push('--reporter=list');
  }

  const playwrightDir = join(options.testsDir, 'playwright');

  if (!options.json) {
    console.log(`\nRunning Playwright tests...`);
    if (options.verbose) {
      console.log(`   Dir: ${playwrightDir}`);
      console.log(`   Command: npx ${args.join(' ')}`);
    }
  }

  return new Promise((resolve) => {
    const proc = spawn('npx', args, {
      cwd: playwrightDir,
      stdio: options.json ? 'pipe' : 'inherit',
      shell: false, // Disable shell to prevent injection
    });

    proc.on('close', (code) => {
      resolve(code ?? 1);
    });

    proc.on('error', (err) => {
      if (!options.json) {
        console.error(`Failed to start Playwright: ${err.message}`);
      }
      resolve(1);
    });
  });
}

/**
 * Run Maestro tests
 */
function runMaestro(options: RunOptions): Promise<number> {
  const maestroDir = join(options.testsDir, 'maestro');
  const args: string[] = [];

  if (options.test) {
    // Sanitize test file path to prevent shell injection
    args.push('test', join(maestroDir, sanitizePath(options.test)));
  } else {
    args.push('test', maestroDir);
  }

  if (options.device) {
    // Sanitize device name to prevent shell injection
    args.push('--device', sanitizePath(options.device));
  }

  if (!options.json) {
    console.log(`\nRunning Maestro tests...`);
    if (options.verbose) {
      console.log(`   Dir: ${maestroDir}`);
      console.log(`   Command: maestro ${args.join(' ')}`);
    }
  }

  return new Promise((resolve) => {
    const proc = spawn('maestro', args, {
      stdio: options.json ? 'pipe' : 'inherit',
      shell: false, // Disable shell to prevent injection
    });

    proc.on('close', (code) => {
      resolve(code ?? 1);
    });

    proc.on('error', (err) => {
      if (!options.json) {
        if (err.message.includes('ENOENT')) {
          console.error(`\nMaestro not found. Install it with:`);
          console.error(`   curl -Ls "https://get.maestro.mobile.dev" | bash`);
        } else {
          console.error(`Failed to start Maestro: ${err.message}`);
        }
      }
      resolve(1);
    });
  });
}

/**
 * Main run command
 */
export async function run(options: RunOptions): Promise<RunResult> {
  const { testsDir, verbose, test, all } = options;

  if (!existsSync(testsDir)) {
    exitWithError('run', `Tests directory not found: ${testsDir}`, options);
  }

  const runners = await detectRunners(testsDir);

  if (runners.length === 0) {
    exitWithError('run', `No tests found in ${testsDir}`, options);
  }

  if (!options.json) {
    console.log(`Found ${runners.length} test runner(s):`);
    for (const runner of runners) {
      console.log(`   - ${runner.name} (${runner.dir})`);
    }
  }

  let exitCode = 0;
  const runnerResults: RunnerResult[] = [];

  for (const runner of runners) {
    const code = await runner.run(options);
    runnerResults.push({ name: runner.name, dir: runner.dir, exitCode: code });
    if (code !== 0) {
      exitCode = code;
    }
  }

  const result: RunResult = {
    runners: runnerResults,
    passed: exitCode === 0,
  };

  if (output('run', result, options)) {
    if (exitCode !== 0) process.exit(exitCode);
    return result;
  }

  if (exitCode === 0) {
    console.log(`\nAll tests passed`);
  } else {
    console.log(`\nSome tests failed`);
    process.exit(exitCode);
  }

  return result;
}

interface RunPerfOptions extends OutputOptions {
  verbose?: boolean;
  headed?: boolean;
}

interface PerfFlowResult {
  name: string;
  passed: boolean;
  metrics: Record<string, { actual: number | null; budget: number; passed: boolean }>;
}

interface RunPerfResult {
  flows: PerfFlowResult[];
  allPassed: boolean;
}

/**
 * Build Playwright CLI args for perf tests.
 */
function buildPerfArgs(perfDir: string, options: RunPerfOptions): string[] {
  const configPath = join(perfDir, 'playwright.perf.config.ts');
  const args = ['playwright', 'test', '--reporter=json'];
  if (existsSync(configPath)) {
    args.push('--config', 'playwright.perf.config.ts');
  }
  if (options.headed) {
    args.push('--headed');
  }
  return args;
}

/**
 * Spawn Playwright and capture JSON output.
 */
function spawnPerfTests(
  perfDir: string,
  args: string[],
  json?: boolean
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    const proc = spawn('npx', args, {
      cwd: perfDir,
      stdio: ['pipe', 'pipe', json ? 'pipe' : 'inherit'],
      shell: false,
    });

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, exitCode: code ?? 1 });
    });

    proc.on('error', () => {
      resolve({ stdout: '', exitCode: 1 });
    });
  });
}

/**
 * Parse Playwright JSON report into a pass/fail map keyed by suite title.
 */
function parsePlaywrightResults(stdout: string): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  try {
    const report = JSON.parse(stdout);
    if (report.suites) {
      for (const suite of report.suites) {
        for (const spec of suite.specs ?? []) {
          const passed = spec.tests?.every((t: { status: string }) => t.status === 'expected') ?? false;
          results[suite.title ?? spec.title] = passed;
        }
      }
    }
  } catch {
    // If we can't parse JSON output, use exit code
  }
  return results;
}

/**
 * Build per-flow perf results by matching baseline flows against Playwright results.
 */
function buildFlowResults(
  baseline: PerfBaseline,
  playwrightResults: Record<string, boolean>,
  fallbackPassed: boolean
): PerfFlowResult[] {
  const flowResults: PerfFlowResult[] = [];

  for (const flow of baseline.flows) {
    const matchKey = `Performance: ${flow.name}`;
    const testPassed = playwrightResults[matchKey] ?? fallbackPassed;

    const metrics: Record<string, { actual: number | null; budget: number; passed: boolean }> = {};
    metrics['totalDuration'] = {
      actual: null,
      budget: flow.budgets.totalDuration.budget,
      passed: testPassed,
    };
    metrics['maxLongTaskDuration'] = {
      actual: null,
      budget: flow.budgets.maxLongTaskDuration.budget,
      passed: testPassed,
    };

    flowResults.push({ name: flow.name, passed: testPassed, metrics });
  }

  return flowResults;
}

/**
 * Build global Web Vitals flow result from baseline budgets.
 */
function buildGlobalVitalsResult(
  baseline: PerfBaseline,
  passed: boolean
): PerfFlowResult | null {
  const globalMetrics: Record<string, { actual: number | null; budget: number; passed: boolean }> = {};
  const vitals: [string, MetricBudget][] = [
    ['lcp', baseline.global.lcp],
    ['cls', baseline.global.cls],
    ['inp', baseline.global.inp],
    ['fcp', baseline.global.fcp],
    ['ttfb', baseline.global.ttfb],
  ];

  for (const [name, data] of vitals) {
    if (data.budget > 0) {
      globalMetrics[name] = { actual: null, budget: data.budget, passed };
    }
  }

  if (Object.keys(globalMetrics).length === 0) return null;
  return { name: '__global__', passed, metrics: globalMetrics };
}

/**
 * Print human-readable perf regression results.
 */
function printPerfResults(flowResults: PerfFlowResult[], allPassed: boolean): void {
  console.log('');
  console.log('Performance Regression Results');
  console.log('==============================');
  console.log('');

  for (const flow of flowResults) {
    const icon = flow.passed ? '\u2713' : '\u2717';
    const label = flow.name === '__global__' ? 'Global Web Vitals' : flow.name;
    console.log(`  ${icon} ${label}`);
    for (const [metric, data] of Object.entries(flow.metrics)) {
      const unit = metric === 'cls' ? '' : 'ms';
      const budgetStr = `${data.budget}${unit}`;
      const status = data.passed ? '\u2713' : '\u2717';
      console.log(`      ${metric}: budget ${budgetStr} ${status}`);
    }
  }

  console.log('');
  if (allPassed) {
    console.log('All performance budgets met.');
  } else {
    console.log('Some performance budgets exceeded.');
    process.exit(1);
  }
}

/**
 * Run perf tests from `.gremlin/tests/perf/` and compare results against baseline.
 */
export async function runPerf(options: RunPerfOptions): Promise<RunPerfResult> {
  const perfDir = '.gremlin/tests/perf';
  const json = options.json;

  if (!existsSync(perfDir)) {
    exitWithError('run', 'No perf tests found. Run `gremlin generate --perf` first.', options);
  }

  const baseline = readBaseline();
  if (!baseline) {
    exitWithError('run', 'No perf baseline found. Run `gremlin perf-baseline` first.', options);
  }

  if (!json) {
    console.log('Running performance tests...');
    console.log(`  Dir: ${perfDir}`);
    console.log('');
  }

  const args = buildPerfArgs(perfDir, options);
  const testOutput = await spawnPerfTests(perfDir, args, json);

  const playwrightResults = parsePlaywrightResults(testOutput.stdout);
  const allPassed = testOutput.exitCode === 0;

  const flowResults = buildFlowResults(baseline, playwrightResults, allPassed);

  const globalResult = buildGlobalVitalsResult(baseline, allPassed);
  if (globalResult) {
    flowResults.unshift(globalResult);
  }

  const result: RunPerfResult = { flows: flowResults, allPassed };

  if (output('run', result, options)) {
    if (!allPassed) process.exit(1);
    return result;
  }

  printPerfResults(flowResults, allPassed);

  return result;
}
