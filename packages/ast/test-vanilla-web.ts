#!/usr/bin/env bun
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractVanillaWebRoutes } from './src/extractors/routes/vanilla-web.js';

// Get the absolute path to the web-app example
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const webAppPath = join(__dirname, '../../examples/web-app');

console.log('🔍 Extracting routes from vanilla web app...');
console.log(`📂 Project: ${webAppPath}\n`);

const result = await extractVanillaWebRoutes({
  rootDir: webAppPath,
  exclude: ['node_modules', 'dist'],
});

console.log('✅ Extraction complete!\n');

// Print file-based routes
const fileBased = result.routes.filter(r => r.source === 'file-based');
console.log(`📄 File-based routes (${fileBased.length}):`);
fileBased.forEach(route => {
  console.log(`  ${route.path}`);
  console.log(`    └─ ${route.filePath}`);
});

// Print link-discovered routes
const linkDiscovered = result.routes.filter(r => r.source === 'link-discovered');
console.log(`\n🔗 Link-discovered routes (${linkDiscovered.length}):`);
linkDiscovered.forEach(route => {
  console.log(`  ${route.path}`);
  console.log(`    └─ Found in: ${route.filePath}`);
});

// Print errors if any
if (result.errors.length > 0) {
  console.log(`\n❌ Errors (${result.errors.length}):`);
  result.errors.forEach(err => {
    console.log(`  ${err.file}: ${err.message}`);
  });
}

// Print summary
console.log('\n📊 Summary:');
console.log(`  Total routes: ${result.routes.length}`);
console.log(`  File-based: ${fileBased.length}`);
console.log(`  Link-discovered: ${linkDiscovered.length}`);
console.log(`  Files scanned: ${result.metadata.filesScanned}`);
console.log(`  Errors: ${result.errors.length}`);

// Export JSON for further analysis
const outputPath = join(__dirname, 'routes-output.json');
await Bun.write(
  outputPath,
  JSON.stringify(result, null, 2)
);
console.log(`\n💾 Full output saved to: ${outputPath}`);
