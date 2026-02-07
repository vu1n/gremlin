/**
 * Run command - unified test runner for generated tests
 *
 * Detects whether Playwright or Maestro tests exist and runs the appropriate runner.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { output, outputError, type OutputOptions } from '../output.ts';

export interface RunOptions extends OutputOptions {
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

export interface RunnerResult {
  name: string;
  dir: string;
  exitCode: number;
}

export interface RunResult {
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
 * Run Playwright tests
 */
async function runPlaywright(options: RunOptions): Promise<number> {
  const args = ['playwright', 'test'];

  if (options.test) {
    args.push(options.test);
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
      shell: true,
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
async function runMaestro(options: RunOptions): Promise<number> {
  const maestroDir = join(options.testsDir, 'maestro');
  const args: string[] = [];

  if (options.test) {
    args.push('test', join(maestroDir, options.test));
  } else {
    args.push('test', maestroDir);
  }

  if (options.device) {
    args.push('--device', options.device);
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
      shell: true,
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
    const result: RunResult = { runners: [], passed: false };
    if (outputError('run', [`Tests directory not found: ${testsDir}`], options)) {
      process.exit(1);
    }
    console.error(`Tests directory not found: ${testsDir}`);
    console.error(`\nGenerate tests first with:`);
    console.error(`  gremlin generate`);
    process.exit(1);
  }

  const runners = await detectRunners(testsDir);

  if (runners.length === 0) {
    const result: RunResult = { runners: [], passed: false };
    if (outputError('run', [`No tests found in ${testsDir}`], options)) {
      process.exit(1);
    }
    console.error(`No tests found in ${testsDir}`);
    console.error(`\nExpected structure:`);
    console.error(`  ${testsDir}/playwright/*.spec.ts`);
    console.error(`  ${testsDir}/maestro/*.yaml`);
    console.error(`\nGenerate tests with:`);
    console.error(`  gremlin generate`);
    process.exit(1);
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
