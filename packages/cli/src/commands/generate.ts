/**
 * Generate Command
 *
 * Generates tests from recorded sessions using AI-powered analysis.
 */

import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { GremlinSession } from '@gremlin/session';
import type { GremlinSpec } from '@gremlin/analysis';
import {
  analyzeFlows,
  generatePlaywrightTests,
  generateMaestroFlows,
  generateMaestroTestSuite,
  generatePerfTests,
  generateErrorTests,
} from '@gremlin/analysis';
import type {
  PerfBaseline as AnalysisPerfBaseline,
  PerfTestResult,
  ErrorTestResult,
} from '@gremlin/analysis';
import { output, outputError, type OutputOptions } from '../output.ts';
import { readBaseline } from '../perf-baseline-types.ts';
import type { PerfBaseline } from '../perf-baseline-types.ts';

// ============================================================================
// Types
// ============================================================================

export interface GenerateOptions extends OutputOptions {
  input?: string;
  output?: string;
  playwright?: boolean;
  maestro?: boolean;
  perf?: boolean;
  errors?: boolean;
  minOccurrences?: number;
  spec?: string;
  baseUrl?: string;
  appId?: string;
  provider?: 'anthropic' | 'openai' | 'gemini';
}

export interface GenerateResult {
  spec: {
    states: number;
    transitions: number;
    variables: number;
    properties: number;
  };
  specPath: string;
  tests: { type: string; path: string; count: number }[];
  provider: string;
}

export interface GeneratePerfResult {
  perfTests: { flowName: string; path: string; stepCount: number }[];
  outputDir: string;
  baselineUsed: boolean;
}

export interface GenerateErrorsResult {
  errorPatterns: Array<{
    fingerprint: string;
    message: string;
    errorType: string;
    occurrences: number;
    sessionIds: string[];
  }>;
  tests: Array<{ name: string; path: string; type: string }>;
  outputDir: string;
}

// ============================================================================
// Main Command
// ============================================================================

export async function generate(options: GenerateOptions): Promise<GenerateResult | GeneratePerfResult | GenerateErrorsResult | null> {
  // Handle --perf mode separately
  if (options.perf) {
    return generatePerf(options);
  }

  // Handle --errors mode separately
  if (options.errors) {
    return generateErrorsCmd(options);
  }

  const {
    input = '.gremlin/sessions',
    output: outputDir = '.gremlin/tests',
    playwright = true,
    maestro = false,
    spec: specPath,
    baseUrl = 'http://localhost:3000',
    appId = 'com.example.app',
    provider = detectProvider(),
    json,
  } = options;

  // Get API key from environment
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    if (outputError('generate', [`No API key found for ${provider}. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY`], options)) {
      process.exit(1);
    }
    console.error(`No API key found for ${provider}`);
    console.error('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
    process.exit(1);
  }

  if (!json) {
    console.log('Gremlin Test Generator');
    console.log('');
    console.log(`Provider: ${provider}`);
  }

  let gremlinSpec: GremlinSpec;

  // Load or generate spec
  if (specPath && existsSync(specPath)) {
    if (!json) console.log(`Loading spec from: ${specPath}`);
    const specJson = await Bun.file(specPath).text();
    gremlinSpec = JSON.parse(specJson);
    if (!json) console.log(`   Found ${gremlinSpec.states.length} states, ${gremlinSpec.transitions.length} transitions`);
  } else {
    if (!json) console.log(`Loading sessions from: ${input}`);

    if (!existsSync(input)) {
      if (outputError('generate', [`Sessions directory not found: ${input}`], options)) {
        process.exit(1);
      }
      console.error(`Sessions directory not found: ${input}`);
      console.error('Run "gremlin record" first or specify --input path');
      process.exit(1);
    }

    const sessions = await loadSessions(input);
    if (!json) console.log(`   Found ${sessions.length} sessions`);

    if (sessions.length === 0) {
      if (outputError('generate', ['No sessions found'], options)) {
        process.exit(1);
      }
      console.error('No sessions found');
      process.exit(1);
    }

    if (!json) {
      console.log('');
      console.log('Analyzing sessions with AI...');
    }

    gremlinSpec = await analyzeFlows(sessions, {
      provider,
      apiKey,
      appName: 'app',
      platform: 'web',
    });

    if (!json) {
      console.log(`   Extracted ${gremlinSpec.states.length} states`);
      console.log(`   Extracted ${gremlinSpec.transitions.length} transitions`);
      console.log(`   Extracted ${gremlinSpec.variables.length} variables`);
      console.log(`   Extracted ${gremlinSpec.properties.length} properties`);
    }

    // Save spec
    const specOutputPath = join(outputDir, 'spec.json');
    ensureDir(outputDir);
    writeFileSync(specOutputPath, JSON.stringify(gremlinSpec, null, 2));
    if (!json) console.log(`   Saved spec to: ${specOutputPath}`);
  }

  // Generate tests
  const tests: { type: string; path: string; count: number }[] = [];

  if (playwright) {
    if (!json) {
      console.log('');
      console.log('Generating Playwright tests...');
    }

    const playwrightCode = generatePlaywrightTests(gremlinSpec, {
      baseUrl,
      includeComments: true,
      includeVisualTests: false,
      timeout: 30000,
      groupBy: 'flow',
    });

    const playwrightPath = join(outputDir, 'playwright', 'generated.spec.ts');
    ensureDir(join(outputDir, 'playwright'));
    writeFileSync(playwrightPath, playwrightCode);
    tests.push({ type: 'playwright', path: playwrightPath, count: 1 });
    if (!json) console.log(`   Saved to: ${playwrightPath}`);
  }

  if (maestro) {
    if (!json) {
      console.log('');
      console.log('Generating Maestro flows...');
    }

    const flows = generateMaestroFlows(gremlinSpec, {
      appId,
      includeComments: true,
      includeScreenshots: false,
      platform: 'ios',
    });

    const maestroDir = join(outputDir, 'maestro');
    ensureDir(maestroDir);

    for (const flow of flows) {
      const flowPath = join(maestroDir, flow.fileName);
      writeFileSync(flowPath, flow.yaml);
      if (!json) console.log(`   Saved flow: ${flow.fileName}`);
    }

    const suitePath = join(maestroDir, 'suite.yaml');
    const suiteYaml = generateMaestroTestSuite(gremlinSpec, {
      appId,
      includeComments: true,
    });
    writeFileSync(suitePath, suiteYaml);
    tests.push({ type: 'maestro', path: maestroDir, count: flows.length });
    if (!json) console.log(`   Saved suite: suite.yaml`);
  }

  const result: GenerateResult = {
    spec: {
      states: gremlinSpec.states.length,
      transitions: gremlinSpec.transitions.length,
      variables: gremlinSpec.variables.length,
      properties: gremlinSpec.properties.length,
    },
    specPath: join(outputDir, 'spec.json'),
    tests,
    provider,
  };

  if (output('generate', result, options)) return result;

  console.log('');
  console.log('Test generation complete!');
  console.log('');
  console.log('Next steps:');

  if (playwright) {
    console.log(`  Run Playwright tests: npx playwright test ${join(outputDir, 'playwright')}`);
  }
  if (maestro) {
    console.log(`  Run Maestro tests: maestro test ${join(outputDir, 'maestro')}`);
  }

  return result;
}

// ============================================================================
// Perf Test Generation
// ============================================================================

/**
 * Convert CLI PerfBaseline format to the analysis package's PerfBaseline format.
 * The CLI stores global vitals at `global.lcp`, while the analysis package
 * expects `global.webVitals.lcp`. Flows differ structurally as well.
 */
function toAnalysisBaseline(
  baseline: PerfBaseline,
  sessions: GremlinSession[]
): AnalysisPerfBaseline {
  const flows: AnalysisPerfBaseline['flows'] = {};

  for (const flow of baseline.flows) {
    // Find session IDs that match this flow's pattern
    const matchingSessionIds = sessions
      .filter((s) => s.header?.sessionId)
      .map((s) => s.header.sessionId);

    // Convert pattern steps to the analysis format
    const steps = flow.pattern.map((p) => {
      const [type, value] = p.split(':');
      if (type === 'navigate') {
        return { type: 'navigation', screen: value, url: `/${value}` };
      }
      return { type: 'tap', target: value };
    });

    flows[flow.name] = {
      sessionIds: matchingSessionIds.slice(0, flow.sessionCount),
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

async function generatePerf(options: GenerateOptions): Promise<GeneratePerfResult | null> {
  const {
    input = '.gremlin/sessions',
    baseUrl = 'http://localhost:3000',
    json,
  } = options;
  const perfOutputDir = '.gremlin/tests/perf';

  // Read baseline
  const baseline = readBaseline();
  if (!baseline) {
    if (outputError('generate', ['No perf baseline found. Run `gremlin perf-baseline` first.'], options)) {
      process.exit(1);
    }
    console.error('No perf baseline found.');
    console.error('Run `gremlin perf-baseline` first to snapshot current performance metrics.');
    process.exit(1);
  }

  // Load sessions
  if (!existsSync(input)) {
    if (outputError('generate', [`Sessions directory not found: ${input}`], options)) {
      process.exit(1);
    }
    console.error(`Sessions directory not found: ${input}`);
    process.exit(1);
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    if (outputError('generate', ['No sessions found'], options)) {
      process.exit(1);
    }
    console.error('No sessions found');
    process.exit(1);
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

// ============================================================================
// Error Test Generation
// ============================================================================

async function generateErrorsCmd(options: GenerateOptions): Promise<GenerateErrorsResult | null> {
  const {
    input = '.gremlin/sessions',
    minOccurrences = 1,
    json,
  } = options;
  const errOutputDir = '.gremlin/tests/error-regression';

  if (!existsSync(input)) {
    if (outputError('generate', [`Sessions directory not found: ${input}`], options)) {
      process.exit(1);
    }
    console.error(`Sessions directory not found: ${input}`);
    process.exit(1);
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    if (outputError('generate', ['No sessions found'], options)) {
      process.exit(1);
    }
    console.error('No sessions found');
    process.exit(1);
  }

  if (!json) {
    console.log('Gremlin Error Regression Test Generator');
    console.log('');
    console.log(`Sessions: ${sessions.length}`);
    console.log(`Min occurrences: ${minOccurrences}`);
    console.log('');
    console.log('Extracting error patterns...');
  }

  const errorResult: ErrorTestResult = generateErrorTests({
    sessions,
    outputDir: errOutputDir,
    minOccurrences,
  });

  const result: GenerateErrorsResult = {
    errorPatterns: errorResult.patterns.map((p) => ({
      fingerprint: p.fingerprint,
      message: p.message,
      errorType: p.errorType,
      occurrences: p.occurrences,
      sessionIds: p.sessionIds,
    })),
    tests: errorResult.tests.map((t) => ({
      name: t.name,
      path: t.path,
      type: t.type,
    })),
    outputDir: errorResult.outputDir,
  };

  if (output('generate', result, options)) return result;

  // Human-readable output
  console.log('');
  if (errorResult.patterns.length === 0) {
    console.log('No error patterns found.');
  } else {
    console.log(`Found ${errorResult.patterns.length} error pattern(s):`);
    for (const p of errorResult.patterns) {
      const fatalTag = p.fatal ? ' [FATAL]' : '';
      console.log(`  ${p.errorType}${fatalTag}: ${p.message} (${p.occurrences} occurrences)`);
    }
  }

  console.log('');
  if (errorResult.tests.length === 0) {
    console.log('No tests generated.');
  } else {
    console.log(`Generated ${errorResult.tests.length} test(s):`);
    for (const t of errorResult.tests) {
      console.log(`  ${t.type}: ${t.name} -> ${t.path}`);
    }
  }

  console.log('');
  console.log('Next steps:');
  console.log('  gremlin run --json');

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

async function loadSessions(dir: string): Promise<GremlinSession[]> {
  const sessions: GremlinSession[] = [];
  const files = readdirSync(dir);

  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = join(dir, file);
      try {
        const content = await Bun.file(filePath).text();
        const session = JSON.parse(content) as GremlinSession;
        sessions.push(session);
      } catch (e) {
        console.warn(`   Warning: Could not load ${file}`);
      }
    }
  }

  return sessions;
}

function detectProvider(): 'anthropic' | 'openai' | 'gemini' {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'gemini'; // Default
}

function getApiKey(provider: 'anthropic' | 'openai' | 'gemini'): string | undefined {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'gemini':
      return process.env.GEMINI_API_KEY;
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
