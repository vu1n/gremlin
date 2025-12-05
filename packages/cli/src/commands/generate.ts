/**
 * Generate Command
 *
 * Generates tests from recorded sessions using AI-powered analysis.
 */

import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { GremlinSession, GremlinSpec } from '@gremlin/core';
import {
  analyzeFlows,
  generatePlaywrightTests,
  generateMaestroFlows,
  generateMaestroTestSuite,
} from '@gremlin/core';

// ============================================================================
// Types
// ============================================================================

export interface GenerateOptions {
  input?: string;
  output?: string;
  playwright?: boolean;
  maestro?: boolean;
  spec?: string;
  baseUrl?: string;
  appId?: string;
  provider?: 'anthropic' | 'openai' | 'gemini';
}

// ============================================================================
// Main Command
// ============================================================================

export async function generate(options: GenerateOptions): Promise<void> {
  console.log('🧪 Gremlin Test Generator');
  console.log('');

  const {
    input = '.gremlin/sessions',
    output = '.gremlin/tests',
    playwright = true,
    maestro = false,
    spec: specPath,
    baseUrl = 'http://localhost:3000',
    appId = 'com.example.app',
    provider = detectProvider(),
  } = options;

  // Get API key from environment
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    console.error(`❌ No API key found for ${provider}`);
    console.error('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
    process.exit(1);
  }

  console.log(`📊 Provider: ${provider}`);

  let gremlinSpec: GremlinSpec;

  // Load or generate spec
  if (specPath && existsSync(specPath)) {
    console.log(`📂 Loading spec from: ${specPath}`);
    const specJson = await Bun.file(specPath).text();
    gremlinSpec = JSON.parse(specJson);
    console.log(`   Found ${gremlinSpec.states.length} states, ${gremlinSpec.transitions.length} transitions`);
  } else {
    // Load sessions and analyze with AI
    console.log(`📂 Loading sessions from: ${input}`);

    if (!existsSync(input)) {
      console.error(`❌ Sessions directory not found: ${input}`);
      console.error('Run "gremlin record" first or specify --input path');
      process.exit(1);
    }

    const sessions = await loadSessions(input);
    console.log(`   Found ${sessions.length} sessions`);

    if (sessions.length === 0) {
      console.error('❌ No sessions found');
      process.exit(1);
    }

    // Analyze with AI
    console.log('');
    console.log('🤖 Analyzing sessions with AI...');

    gremlinSpec = await analyzeFlows(sessions, {
      provider,
      apiKey,
      appName: 'app',
      platform: 'web',
    });

    console.log(`   Extracted ${gremlinSpec.states.length} states`);
    console.log(`   Extracted ${gremlinSpec.transitions.length} transitions`);
    console.log(`   Extracted ${gremlinSpec.variables.length} variables`);
    console.log(`   Extracted ${gremlinSpec.properties.length} properties`);

    // Save spec
    const specOutputPath = join(output, 'spec.json');
    ensureDir(output);
    writeFileSync(specOutputPath, JSON.stringify(gremlinSpec, null, 2));
    console.log(`   Saved spec to: ${specOutputPath}`);
  }

  // Generate tests
  console.log('');

  if (playwright) {
    console.log('🎭 Generating Playwright tests...');

    const playwrightCode = generatePlaywrightTests(gremlinSpec, {
      baseUrl,
      includeComments: true,
      includeVisualTests: false,
      timeout: 30000,
      groupBy: 'flow',
    });

    const playwrightPath = join(output, 'playwright', 'generated.spec.ts');
    ensureDir(join(output, 'playwright'));
    writeFileSync(playwrightPath, playwrightCode);
    console.log(`   Saved to: ${playwrightPath}`);
  }

  if (maestro) {
    console.log('📱 Generating Maestro flows...');

    const flows = generateMaestroFlows(gremlinSpec, {
      appId,
      includeComments: true,
      includeScreenshots: false,
      platform: 'ios',
    });

    const maestroDir = join(output, 'maestro');
    ensureDir(maestroDir);

    for (const flow of flows) {
      const flowPath = join(maestroDir, flow.fileName);
      writeFileSync(flowPath, flow.yaml);
      console.log(`   Saved flow: ${flow.fileName}`);
    }

    // Also generate combined suite
    const suitePath = join(maestroDir, 'suite.yaml');
    const suiteYaml = generateMaestroTestSuite(gremlinSpec, {
      appId,
      includeComments: true,
    });
    writeFileSync(suitePath, suiteYaml);
    console.log(`   Saved suite: suite.yaml`);
  }

  console.log('');
  console.log('✅ Test generation complete!');
  console.log('');
  console.log('Next steps:');

  if (playwright) {
    console.log(`  • Run Playwright tests: npx playwright test ${join(output, 'playwright')}`);
  }
  if (maestro) {
    console.log(`  • Run Maestro tests: maestro test ${join(output, 'maestro')}`);
  }
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
