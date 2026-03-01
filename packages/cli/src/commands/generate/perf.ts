/**
 * Performance test generation from perf baselines.
 */

import { existsSync } from 'fs';
import { loadSessions } from '../shared/sessions.ts';
import { toAnalysisBaseline } from '../shared/baseline.ts';
import { generatePerfTests } from '@gremlin/analysis';
import type { PerfTestResult } from '@gremlin/analysis';
import { output, exitWithError } from '../../output.ts';
import { readBaseline } from '../../perf-baseline-types.ts';
import type { GenerateOptions, GeneratePerfResult } from './types.ts';

export async function generatePerf(options: GenerateOptions): Promise<GeneratePerfResult | null> {
  const {
    input = '.gremlin/sessions',
    baseUrl = 'http://localhost:3000',
    json,
  } = options;
  const perfOutputDir = '.gremlin/tests/perf';

  // Read baseline
  const baseline = readBaseline();
  if (!baseline) {
    exitWithError('generate', 'No perf baseline found. Run `gremlin perf-baseline` first.', options);
  }

  // Load sessions
  if (!existsSync(input)) {
    exitWithError('generate', `Sessions directory not found: ${input}`, options);
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    exitWithError('generate', 'No sessions found', options);
  }

  if (!json) {
    console.log('Gremlin Performance Test Generator');
    console.log('');
    console.log(`Sessions: ${sessions.length}`);
    console.log(`Baseline flows: ${baseline.flows.length}`);
    console.log('');
    console.log('Generating performance tests...');
  }

  // Convert baseline format and generate
  const analysisBaseline = toAnalysisBaseline(baseline, sessions);
  const perfResult: PerfTestResult = generatePerfTests({
    sessions,
    baseline: analysisBaseline,
    baseUrl,
    outputDir: perfOutputDir,
  });

  const result: GeneratePerfResult = {
    perfTests: perfResult.tests,
    outputDir: perfResult.outputDir,
    baselineUsed: true,
  };

  if (output('generate', result, options)) return result;

  // Human-readable output
  console.log('');
  if (perfResult.tests.length === 0) {
    console.log('No perf tests generated (baseline has no flows).');
  } else {
    console.log(`Generated ${perfResult.tests.length} perf test(s):`);
    for (const t of perfResult.tests) {
      console.log(`  ${t.flowName} — ${t.stepCount} steps → ${t.path}`);
    }
  }
  console.log('');
  console.log('Next steps:');
  console.log(`  Run perf tests: gremlin run --perf`);

  return result;
}
