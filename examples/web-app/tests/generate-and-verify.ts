/**
 * Gremlin Demo: Generate Playwright Tests from GremlinSpec
 *
 * This script demonstrates the core Gremlin pipeline:
 * 1. Load a GremlinSpec (state machine inferred from user sessions)
 * 2. Feed it into the Playwright test generator
 * 3. Write the generated tests to disk
 *
 * Usage: bun tests/generate-and-verify.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generatePlaywrightTests } from '@gremlin/analysis/generators';
import type { GremlinSpec } from '@gremlin/analysis/spec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const specPath = resolve(__dirname, '../../../examples/sample-output/tests/spec.json');
const outputPath = resolve(__dirname, 'generated.spec.ts');

console.log('=== Gremlin Test Generator ===\n');

// Step 1: Load the GremlinSpec
console.log(`Loading spec from: ${specPath}`);
const specJson = readFileSync(specPath, 'utf-8');
const spec = JSON.parse(specJson) as GremlinSpec;

console.log(`  Spec name: ${spec.name}`);
console.log(`  States: ${spec.states.length}`);
console.log(`  Transitions: ${spec.transitions.length}`);
console.log(`  Properties: ${spec.properties.length}`);
console.log(`  Sessions analyzed: ${spec.metadata.sessionCount}`);
console.log('');

// Step 2: Generate Playwright tests
console.log('Generating Playwright tests...');
const generatedCode = generatePlaywrightTests(spec, {
  baseUrl: '/',
  includeComments: true,
  includeVisualTests: false,
  timeout: 30000,
  groupBy: 'flow',
});

// Step 3: Write generated tests
writeFileSync(outputPath, generatedCode, 'utf-8');
console.log(`  Written to: ${outputPath}`);
console.log(`  Size: ${generatedCode.length} bytes`);
console.log(`  Lines: ${generatedCode.split('\n').length}`);
console.log('');

// Step 4: Show a summary of what was generated
const testMatches = generatedCode.match(/test\('([^']+)'/g);
if (testMatches) {
  console.log(`Generated ${testMatches.length} test(s):`);
  for (const match of testMatches) {
    const name = match.replace("test('", '').replace("'", '');
    console.log(`  - ${name}`);
  }
} else {
  console.log('No test cases detected in output.');
}
console.log('');

// Step 5: Show a preview of the generated code
console.log('--- Preview (first 40 lines) ---');
const lines = generatedCode.split('\n');
for (let i = 0; i < Math.min(40, lines.length); i++) {
  console.log(lines[i]);
}
if (lines.length > 40) {
  console.log(`... (${lines.length - 40} more lines)`);
}
console.log('--- End Preview ---\n');

console.log('Test generation complete. Run `npx playwright test` to execute.');
