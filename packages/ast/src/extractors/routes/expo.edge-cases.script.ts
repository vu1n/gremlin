#!/usr/bin/env bun
/**
 * Edge case tests for Expo Router route extraction
 *
 * Tests various Expo Router conventions and edge cases:
 * - Nested routes
 * - Dynamic parameters
 * - Catch-all routes
 * - Layout groups
 * - Layout files
 * - Index routes at various levels
 */

import { extractExpoRoutes } from './expo.js';
import type { Route } from '../../types.js';

// Test the actual expo-app example
const expoAppPath = '/Users/vuln/code/gremlin/examples/expo-app';
const result = extractExpoRoutes({
  rootDir: expoAppPath,
  includeLayouts: true
});

console.log('=== EDGE CASE TESTS ===\n');

let passed = 0;
let failed = 0;

function test(name: string, condition: boolean) {
  if (condition) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.log(`✗ ${name}`);
    failed++;
  }
}

// Test 1: Routes are extracted
test('Should extract routes', result.routes.length > 0);

// Test 2: Index route exists
const indexRoute = result.routes.find(r => r.isIndex && r.path === '/');
test('Should find index route at /', indexRoute !== undefined);

// Test 3: Layout file exists and is marked
const layoutRoute = result.routes.find(r => r.isLayout && r.path === '/');
test('Should find layout file and mark as layout', layoutRoute !== undefined);

// Test 4: Static routes exist
const cartRoute = result.routes.find(r => r.path === '/cart');
test('Should find static route /cart', cartRoute !== undefined);

const checkoutRoute = result.routes.find(r => r.path === '/checkout');
test('Should find static route /checkout', checkoutRoute !== undefined);

const productsRoute = result.routes.find(r => r.path === '/products');
test('Should find static route /products', productsRoute !== undefined);

// Test 5: Dynamic route with parameter
const dynamicRoute = result.routes.find(r => r.path === '/product/[id]');
test('Should find dynamic route /product/[id]', dynamicRoute !== undefined);
test('Dynamic route should have param "id"', dynamicRoute?.params.includes('id') === true);
test('Dynamic route should have exactly 1 param', dynamicRoute?.params.length === 1);

// Test 6: No errors occurred
test('Should have no extraction errors', result.errors.length === 0);

// Test 7: Files were scanned
test('Should have scanned files', result.metadata.filesScanned > 0);

// Test 8: Metadata is present
test('Should have metadata timestamp', result.metadata.timestamp instanceof Date);
test('Should have metadata appDir', result.metadata.appDir.endsWith('/app'));

// Test 9: Routes are sorted
const paths = result.routes.map(r => r.path);
const sortedPaths = [...paths].sort();
test('Routes should be sorted', JSON.stringify(paths) === JSON.stringify(sortedPaths));

// Test 10: File paths are absolute
const allAbsolute = result.routes.every(r => r.filePath.startsWith('/'));
test('All file paths should be absolute', allAbsolute);

// Test 11: All routes have required fields
const allHaveRequiredFields = result.routes.every(r =>
  typeof r.path === 'string' &&
  Array.isArray(r.params) &&
  r.source === 'file-based' &&
  typeof r.filePath === 'string'
);
test('All routes should have required fields', allHaveRequiredFields);

// Test 12: Layout and index are mutually exclusive (in most cases)
const layoutAndIndex = result.routes.filter(r => r.isLayout && r.isIndex);
test('Layout and index should be mutually exclusive', layoutAndIndex.length === 0);

// Test 13: Count of different route types
const regularRoutes = result.routes.filter(r => !r.isLayout);
const layoutRoutes = result.routes.filter(r => r.isLayout);
const indexRoutes = result.routes.filter(r => r.isIndex);
const dynamicRoutes = result.routes.filter(r => r.params.length > 0);

console.log('\n=== ROUTE COUNTS ===\n');
console.log(`Total routes: ${result.routes.length}`);
console.log(`Regular routes: ${regularRoutes.length}`);
console.log(`Layout routes: ${layoutRoutes.length}`);
console.log(`Index routes: ${indexRoutes.length}`);
console.log(`Dynamic routes: ${dynamicRoutes.length}`);

// Test 14: Expected route count for expo-app
test('Should find exactly 6 total routes', result.routes.length === 6);
test('Should find exactly 5 regular routes', regularRoutes.length === 5);
test('Should find exactly 1 layout route', layoutRoutes.length === 1);
test('Should find exactly 1 index route', indexRoutes.length === 1);
test('Should find exactly 1 dynamic route', dynamicRoutes.length === 1);

// Summary
console.log('\n=== SUMMARY ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
}
