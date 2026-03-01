#!/usr/bin/env bun
/**
 * Test script for Expo Router route extraction
 * Run with: bun run src/extractors/routes/expo.script.ts
 */

import { join, resolve, dirname } from 'path';
import { extractExpoRoutes, printRoutes } from './expo.ts';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const expoAppPath = resolve(__dirname, '../../../../../examples/expo-app');

console.log('Testing Expo Router route extraction...');
console.log(`App path: ${expoAppPath}\n`);

// Extract routes
const result = await extractExpoRoutes({
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
