/**
 * Run command - unified test runner for generated tests
 *
 * Detects whether Playwright or Maestro tests exist and runs the appropriate runner.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface RunOptions {
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

  // Add test pattern if specified
  if (options.test) {
    args.push(options.test);
  }

  // Add options
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

  // Set working directory to playwright tests dir
  const playwrightDir = join(options.testsDir, 'playwright');

  console.log(`\n🎭 Running Playwright tests...`);
  if (options.verbose) {
    console.log(`   Dir: ${playwrightDir}`);
    console.log(`   Command: npx ${args.join(' ')}`);
  }

  return new Promise((resolve) => {
    const proc = spawn('npx', args, {
      cwd: playwrightDir,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      resolve(code ?? 1);
    });

    proc.on('error', (err) => {
      console.error(`Failed to start Playwright: ${err.message}`);
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
    // Run specific test
    args.push('test', join(maestroDir, options.test));
  } else {
    // Run all tests in directory
    args.push('test', maestroDir);
  }

  // Add device if specified
  if (options.device) {
    args.push('--device', options.device);
  }

  console.log(`\n📱 Running Maestro tests...`);
  if (options.verbose) {
    console.log(`   Dir: ${maestroDir}`);
    console.log(`   Command: maestro ${args.join(' ')}`);
  }

  return new Promise((resolve) => {
    const proc = spawn('maestro', args, {
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      resolve(code ?? 1);
    });

    proc.on('error', (err) => {
      if (err.message.includes('ENOENT')) {
        console.error(`\n❌ Maestro not found. Install it with:`);
        console.error(`   curl -Ls "https://get.maestro.mobile.dev" | bash`);
      } else {
        console.error(`Failed to start Maestro: ${err.message}`);
      }
      resolve(1);
    });
  });
}

/**
 * Main run command
 */
export async function run(options: RunOptions): Promise<void> {
  const { testsDir, verbose, test, all } = options;

  if (!existsSync(testsDir)) {
    console.error(`❌ Tests directory not found: ${testsDir}`);
    console.error(`\nGenerate tests first with:`);
    console.error(`  gremlin generate`);
    process.exit(1);
  }

  const runners = await detectRunners(testsDir);

  if (runners.length === 0) {
    console.error(`❌ No tests found in ${testsDir}`);
    console.error(`\nExpected structure:`);
    console.error(`  ${testsDir}/playwright/*.spec.ts`);
    console.error(`  ${testsDir}/maestro/*.yaml`);
    console.error(`\nGenerate tests with:`);
    console.error(`  gremlin generate`);
    process.exit(1);
  }

  console.log(`🔍 Found ${runners.length} test runner(s):`);
  for (const runner of runners) {
    console.log(`   - ${runner.name} (${runner.dir})`);
  }

  let exitCode = 0;

  for (const runner of runners) {
    const code = await runner.run(options);
    if (code !== 0) {
      exitCode = code;
      // Continue running other test types even if one fails
    }
  }

  if (exitCode === 0) {
    console.log(`\n✅ All tests passed`);
  } else {
    console.log(`\n❌ Some tests failed`);
    process.exit(exitCode);
  }
}
