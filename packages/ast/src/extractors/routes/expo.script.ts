#!/usr/bin/env bun
/**
 * Test script for Expo Router route extraction
 * Run with: bun run src/extractors/routes/expo.test.ts
 */

import { join } from 'path';
import { extractExpoRoutes, printRoutes } from './expo.js';

// Path to the expo-app example
// When running from packages/ast, we need to go up to the gremlin root
const expoAppPath = '/Users/vuln/code/gremlin/examples/expo-app';

console.log('Testing Expo Router route extraction...');
console.log(`App path: ${expoAppPath}\n`);

// Extract routes
const result = extractExpoRoutes({
  rootDir: expoAppPath,
  includeLayouts: true
});

// Print results
printRoutes(result);

// Additional analysis
console.log('=== ANALYSIS ===\n');

const regularRoutes = result.routes.filter(r => !r.isLayout);
const layoutRoutes = result.routes.filter(r => r.isLayout);
const dynamicRoutes = result.routes.filter(r => r.params.length > 0);
const indexRoutes = result.routes.filter(r => r.isIndex);

console.log(`Regular routes: ${regularRoutes.length}`);
console.log(`Layout routes: ${layoutRoutes.length}`);
console.log(`Dynamic routes: ${dynamicRoutes.length}`);
console.log(`Index routes: ${indexRoutes.length}`);

console.log('\nDynamic routes with parameters:');
dynamicRoutes.forEach(route => {
  console.log(`  ${route.path} → params: [${route.params.join(', ')}]`);
});

console.log('\n=== JSON OUTPUT ===\n');
console.log(JSON.stringify(result, null, 2));
