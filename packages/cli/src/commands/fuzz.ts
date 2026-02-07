/**
 * Fuzz Command
 *
 * Generates chaos/fuzz tests from GremlinSpec to find edge cases and bugs.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSpec, FuzzStrategy } from '@gremlin/analysis';
import { generateFuzzTests, fuzzTestsToPlaywrightFile } from '@gremlin/analysis';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface FuzzOptions extends OutputOptions {
  spec?: string;
  output?: string;
  strategy?: string;
  count?: number;
  seed?: number;
}

export interface FuzzResult {
  testCount: number;
  strategies: string[];
  outputPath: string;
  seed: number;
  bugCategories: string[];
}

// ============================================================================
// Main Command
// ============================================================================

export async function fuzz(options: FuzzOptions): Promise<FuzzResult | null> {
  const {
    spec: specPath = '.gremlin/tests/spec.json',
    output: outputDir = '.gremlin/tests/fuzz',
    strategy = 'all',
    count = 10,
    seed = Date.now(),
    json,
  } = options;

  if (!json) {
    console.log('Gremlin Fuzz Test Generator');
    console.log('');
    console.log(`Loading spec from: ${specPath}`);
  }

  if (!existsSync(specPath)) {
    if (outputError('fuzz', [`Spec file not found: ${specPath}. Run "gremlin generate" first.`], options)) {
      process.exit(1);
    }
    console.error(`Spec file not found: ${specPath}`);
    console.error('Run "gremlin generate" first to create a spec, or use --spec to specify a path');
    process.exit(1);
  }

  let gremlinSpec: GremlinSpec;
  try {
    const specJson = await Bun.file(specPath).text();
    gremlinSpec = JSON.parse(specJson);
    if (!json) console.log(`   Found ${gremlinSpec.states.length} states, ${gremlinSpec.transitions.length} transitions`);
  } catch (e) {
    if (outputError('fuzz', [`Failed to load spec: ${e}`], options)) {
      process.exit(1);
    }
    console.error(`Failed to load spec: ${e}`);
    process.exit(1);
  }

  // Parse strategies
  const strategies = parseStrategies(strategy);
  if (!json) {
    console.log('');
    console.log(`Fuzzing strategies: ${strategies.join(', ')}`);
    console.log(`   Generating ${count} tests with seed ${seed}`);
    console.log('');
    console.log('Generating fuzz tests...');
  }

  const fuzzTests = generateFuzzTests(gremlinSpec, {
    numTests: count,
    strategies,
    seed,
    includeComments: true,
  });

  if (!json) console.log(`   Generated ${fuzzTests.length} fuzz tests`);

  // Group by strategy for summary
  const strategyGroups = new Map<string, number>();
  for (const test of fuzzTests) {
    const current = strategyGroups.get(test.strategy) || 0;
    strategyGroups.set(test.strategy, current + 1);
  }

  if (!json) {
    console.log('');
    console.log('Test breakdown by strategy:');
    for (const [strategyName, testCount] of strategyGroups.entries()) {
      console.log(`   ${formatStrategyName(strategyName)}: ${testCount} tests`);
    }
    console.log('');
    console.log('Converting to Playwright tests...');
  }

  const playwrightCode = fuzzTestsToPlaywrightFile(gremlinSpec, fuzzTests, {
    baseUrl: 'http://localhost:3000',
    includeComments: true,
  });

  ensureDir(outputDir);
  const outputPath = join(outputDir, 'generated.spec.ts');
  writeFileSync(outputPath, playwrightCode);

  // Collect bug categories
  const allBugCategories = new Set<string>();
  for (const test of fuzzTests) {
    if (test.bugCategories) {
      for (const category of test.bugCategories) {
        allBugCategories.add(category);
      }
    }
  }

  const result: FuzzResult = {
    testCount: fuzzTests.length,
    strategies: Array.from(strategyGroups.keys()),
    outputPath,
    seed,
    bugCategories: Array.from(allBugCategories).sort(),
  };

  if (output('fuzz', result, options)) return result;

  if (!json) console.log(`   Saved to: ${outputPath}`);

  if (allBugCategories.size > 0) {
    console.log('');
    console.log('Bug categories these tests may catch:');
    for (const category of Array.from(allBugCategories).sort()) {
      console.log(`   ${category}`);
    }
  }

  console.log('');
  console.log('Fuzz test generation complete!');
  console.log('');
  console.log('Next steps:');
  console.log(`  Run tests: npx playwright test ${outputDir}`);
  console.log(`  Review generated tests at: ${outputPath}`);

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function parseStrategies(strategy: string): FuzzStrategy[] {
  const ALL_STRATEGIES: FuzzStrategy[] = [
    'random_walk',
    'boundary_abuse',
    'sequence_mutation',
    'back_button_chaos',
    'rapid_fire',
    'invalid_state_access',
  ];

  if (strategy === 'all') {
    return ALL_STRATEGIES;
  }

  const strategyMap: Record<string, FuzzStrategy> = {
    'random-walk': 'random_walk',
    random: 'random_walk',
    'boundary-abuse': 'boundary_abuse',
    boundary: 'boundary_abuse',
    'sequence-mutation': 'sequence_mutation',
    sequence: 'sequence_mutation',
    mutation: 'sequence_mutation',
    'back-button-chaos': 'back_button_chaos',
    back: 'back_button_chaos',
    'rapid-fire': 'rapid_fire',
    rapid: 'rapid_fire',
    'invalid-state-access': 'invalid_state_access',
    invalid: 'invalid_state_access',
    chaos: 'random_walk',
  };

  const requestedStrategies = strategy
    .toLowerCase()
    .split(',')
    .map((s) => s.trim());

  const result: FuzzStrategy[] = [];
  for (const requested of requestedStrategies) {
    const mapped = strategyMap[requested];
    if (mapped && !result.includes(mapped)) {
      result.push(mapped);
    }
  }

  if (result.length === 0) {
    console.warn(`   Warning: Unknown strategy "${strategy}", using all strategies`);
    return ALL_STRATEGIES;
  }

  return result;
}

function formatStrategyName(strategy: string): string {
  return strategy
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
