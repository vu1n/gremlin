/**
 * Generate tests from recorded sessions using AI-powered analysis.
 *
 * Handles the main `generate` workflow: load/analyze sessions, emit
 * Playwright and/or Maestro test files.
 */

import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSpec } from '@gremlin/analysis';
import {
  analyzeFlows,
  generatePlaywrightTests,
  generateMaestroFlows,
  generateMaestroTestSuite,
} from '@gremlin/analysis';
import { ensureDir, loadSessions } from '../shared/sessions.ts';
import { detectProvider, getApiKey } from '../shared/ai.ts';
import { output, exitWithError } from '../../output.ts';
import type { GenerateOptions, GenerateResult } from './types.ts';

/**
 * Load spec from a file or generate it from sessions using AI analysis.
 */
async function loadOrGenerateSpec(
  options: {
    specPath?: string;
    input: string;
    outputDir: string;
    provider: 'anthropic' | 'openai' | 'gemini';
    apiKey: string;
    json?: boolean;
  }
): Promise<GremlinSpec> {
  const { specPath, input, outputDir, provider, apiKey, json } = options;

  if (specPath && existsSync(specPath)) {
    if (!json) console.log(`Loading spec from: ${specPath}`);
    const specJson = await Bun.file(specPath).text();
    let gremlinSpec: GremlinSpec;
    try {
      gremlinSpec = JSON.parse(specJson);
    } catch {
      // exitWithError throws, so this code path never continues
      exitWithError('generate', `Invalid JSON in spec file: ${specPath}`, { json });
      throw new Error('unreachable');
    }
    if (!json) console.log(`   Found ${gremlinSpec.states.length} states, ${gremlinSpec.transitions.length} transitions`);
    return gremlinSpec;
  }

  if (!json) console.log(`Loading sessions from: ${input}`);

  if (!existsSync(input)) {
    exitWithError('generate', `Sessions directory not found: ${input}`, { json });
  }

  const sessions = await loadSessions(input);
  if (!json) console.log(`   Found ${sessions.length} sessions`);

  if (sessions.length === 0) {
    exitWithError('generate', 'No sessions found', { json });
  }

  if (!json) {
    console.log('');
    console.log('Analyzing sessions with AI...');
  }

  const gremlinSpec = await analyzeFlows(sessions, {
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

  const specOutputPath = join(outputDir, 'spec.json');
  ensureDir(outputDir);
  writeFileSync(specOutputPath, JSON.stringify(gremlinSpec, null, 2));
  if (!json) console.log(`   Saved spec to: ${specOutputPath}`);

  return gremlinSpec;
}

/**
 * Generate Playwright test files from a GremlinSpec.
 */
function emitPlaywrightTests(
  spec: GremlinSpec,
  outputDir: string,
  baseUrl: string,
  json?: boolean
): { type: string; path: string; count: number } {
  if (!json) {
    console.log('');
    console.log('Generating Playwright tests...');
  }

  const playwrightCode = generatePlaywrightTests(spec, {
    baseUrl,
    includeComments: true,
    includeVisualTests: false,
    timeout: 30000,
    groupBy: 'flow',
  });

  const playwrightPath = join(outputDir, 'playwright', 'generated.spec.ts');
  ensureDir(join(outputDir, 'playwright'));
  writeFileSync(playwrightPath, playwrightCode);
  if (!json) console.log(`   Saved to: ${playwrightPath}`);
  return { type: 'playwright', path: playwrightPath, count: 1 };
}

/**
 * Generate Maestro flow files from a GremlinSpec.
 */
function emitMaestroTests(
  spec: GremlinSpec,
  outputDir: string,
  appId: string,
  json?: boolean
): { type: string; path: string; count: number } {
  if (!json) {
    console.log('');
    console.log('Generating Maestro flows...');
  }

  const flows = generateMaestroFlows(spec, {
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
  const suiteYaml = generateMaestroTestSuite(spec, {
    appId,
    includeComments: true,
  });
  writeFileSync(suitePath, suiteYaml);
  if (!json) console.log(`   Saved suite: suite.yaml`);
  return { type: 'maestro', path: maestroDir, count: flows.length };
}

export async function generateTests(options: GenerateOptions): Promise<GenerateResult | null> {
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

  if (!provider) {
    exitWithError('generate', 'No AI provider configured. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY', options);
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    exitWithError('generate', `No API key found for ${provider}. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY`, options);
  }

  if (!json) {
    console.log('Gremlin Test Generator');
    console.log('');
    console.log(`Provider: ${provider}`);
  }

  const gremlinSpec = await loadOrGenerateSpec({
    specPath, input, outputDir, provider, apiKey, json,
  });

  const tests: { type: string; path: string; count: number }[] = [];

  if (playwright) {
    tests.push(emitPlaywrightTests(gremlinSpec, outputDir, baseUrl, json));
  }

  if (maestro) {
    tests.push(emitMaestroTests(gremlinSpec, outputDir, appId, json));
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
