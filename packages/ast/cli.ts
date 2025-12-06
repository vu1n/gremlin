#!/usr/bin/env bun
/**
 * CLI tool for testing route extraction
 * Usage: bun run cli.ts <path-to-app>
 */

import { extractExpoRoutes, printRoutes } from './src/index.js';

const appPath = process.argv[2];

if (!appPath) {
  console.error('Usage: bun run cli.ts <path-to-app>');
  console.error('Example: bun run cli.ts /Users/vuln/code/gremlin/examples/expo-app');
  process.exit(1);
}

console.log(`Extracting routes from: ${appPath}\n`);

const result = extractExpoRoutes({
  rootDir: appPath,
  includeLayouts: true
});

printRoutes(result);

// Show summary
const regularRoutes = result.routes.filter(r => !r.isLayout);
const dynamicRoutes = result.routes.filter(r => r.params.length > 0);

console.log('=== SUMMARY ===\n');
console.log(`Total routes: ${regularRoutes.length}`);
console.log(`Dynamic routes: ${dynamicRoutes.length}`);
console.log(`Layout files: ${result.routes.filter(r => r.isLayout).length}`);
console.log(`Files scanned: ${result.metadata.filesScanned}`);
console.log(`Errors: ${result.errors.length}`);

if (result.errors.length > 0) {
  console.log('\nErrors encountered:');
  result.errors.forEach(err => {
    console.log(`  - ${err.file}: ${err.message}`);
  });
}
