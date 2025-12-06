#!/usr/bin/env bun
/**
 * Example: Compare extracted routes against session data
 *
 * This demonstrates how to use AST route extraction to identify:
 * - Routes that exist in code but haven't been visited in sessions
 * - Routes visited in sessions that don't exist in code (404s, errors)
 * - Coverage percentage
 */

import { extractExpoRoutes } from '../src/index.js';

// Example session data (from Gremlin recordings)
interface SessionRoute {
  path: string;
  timestamp: string;
  sessionId: string;
}

// Mock session data - in real usage, this would come from Gremlin session recordings
const sessionRoutes: SessionRoute[] = [
  { path: '/', timestamp: '2025-12-06T10:00:00Z', sessionId: 'session-1' },
  { path: '/products', timestamp: '2025-12-06T10:01:00Z', sessionId: 'session-1' },
  { path: '/product/laptop-1', timestamp: '2025-12-06T10:02:00Z', sessionId: 'session-1' },
  { path: '/cart', timestamp: '2025-12-06T10:03:00Z', sessionId: 'session-1' },
  { path: '/checkout', timestamp: '2025-12-06T10:04:00Z', sessionId: 'session-1' },
  { path: '/product/phone-2', timestamp: '2025-12-06T11:00:00Z', sessionId: 'session-2' },
  { path: '/nonexistent-route', timestamp: '2025-12-06T11:05:00Z', sessionId: 'session-2' },
];

// Extract routes from codebase
const expoAppPath = '/Users/vuln/code/gremlin/examples/expo-app';
const extractionResult = extractExpoRoutes({
  rootDir: expoAppPath,
  includeLayouts: false // Exclude layouts from coverage analysis
});

// Normalize dynamic routes for comparison
function normalizeRoute(path: string, pattern: string): boolean {
  // Simple pattern matching for [param] style routes
  const patternRegex = pattern.replace(/\[([^\]]+)\]/g, '([^/]+)');
  const regex = new RegExp(`^${patternRegex}$`);
  return regex.test(path);
}

// Get all static routes (no params)
const staticRoutes = extractionResult.routes.filter(r => r.params.length === 0 && !r.isLayout);
const dynamicRoutes = extractionResult.routes.filter(r => r.params.length > 0 && !r.isLayout);

console.log('=== ROUTE COVERAGE ANALYSIS ===\n');

// Find visited routes
const visitedPaths = new Set(sessionRoutes.map(r => r.path));
const visitedStaticRoutes = staticRoutes.filter(r => visitedPaths.has(r.path));
const visitedDynamicRoutes = dynamicRoutes.filter(r =>
  sessionRoutes.some(sr => normalizeRoute(sr.path, r.path))
);

// Find unvisited routes
const unvisitedStaticRoutes = staticRoutes.filter(r => !visitedPaths.has(r.path));
const unvisitedDynamicRoutes = dynamicRoutes.filter(r =>
  !sessionRoutes.some(sr => normalizeRoute(sr.path, r.path))
);

// Find routes in sessions that don't exist in code (potential 404s)
const unknownRoutes = sessionRoutes.filter(sr => {
  const matchesStatic = staticRoutes.some(r => r.path === sr.path);
  const matchesDynamic = dynamicRoutes.some(r => normalizeRoute(sr.path, r.path));
  return !matchesStatic && !matchesDynamic;
});

// Calculate coverage
const totalRoutes = staticRoutes.length + dynamicRoutes.length;
const visitedRoutes = visitedStaticRoutes.length + visitedDynamicRoutes.length;
const coverage = totalRoutes > 0 ? (visitedRoutes / totalRoutes * 100).toFixed(1) : '0';

console.log(`Total routes in codebase: ${totalRoutes}`);
console.log(`  Static routes: ${staticRoutes.length}`);
console.log(`  Dynamic routes: ${dynamicRoutes.length}`);
console.log('');

console.log(`Visited routes: ${visitedRoutes} (${coverage}% coverage)`);
console.log(`  Static: ${visitedStaticRoutes.length}/${staticRoutes.length}`);
console.log(`  Dynamic: ${visitedDynamicRoutes.length}/${dynamicRoutes.length}`);
console.log('');

if (unvisitedStaticRoutes.length > 0 || unvisitedDynamicRoutes.length > 0) {
  console.log('⚠️  UNVISITED ROUTES:');
  unvisitedStaticRoutes.forEach(r => {
    console.log(`  - ${r.path} (${r.filePath})`);
  });
  unvisitedDynamicRoutes.forEach(r => {
    console.log(`  - ${r.path} (${r.filePath})`);
  });
  console.log('');
}

if (unknownRoutes.length > 0) {
  console.log('❌ ROUTES VISITED BUT NOT IN CODE (potential 404s):');
  unknownRoutes.forEach(r => {
    console.log(`  - ${r.path} (session: ${r.sessionId})`);
  });
  console.log('');
}

console.log('=== VISITED ROUTES DETAIL ===\n');
visitedStaticRoutes.forEach(r => {
  const visits = sessionRoutes.filter(sr => sr.path === r.path);
  console.log(`✓ ${r.path}`);
  console.log(`  Visits: ${visits.length}`);
  console.log(`  Sessions: ${[...new Set(visits.map(v => v.sessionId))].join(', ')}`);
  console.log('');
});

visitedDynamicRoutes.forEach(r => {
  const visits = sessionRoutes.filter(sr => normalizeRoute(sr.path, r.path));
  console.log(`✓ ${r.path} (dynamic)`);
  console.log(`  Visits: ${visits.length}`);
  console.log(`  Examples: ${visits.map(v => v.path).slice(0, 3).join(', ')}`);
  console.log(`  Sessions: ${[...new Set(visits.map(v => v.sessionId))].join(', ')}`);
  console.log('');
});

console.log('=== RECOMMENDATIONS ===\n');

if (coverage === '100.0') {
  console.log('🎉 Perfect coverage! All routes have been visited in sessions.');
} else {
  console.log(`📊 Current coverage: ${coverage}%`);
  if (unvisitedStaticRoutes.length > 0 || unvisitedDynamicRoutes.length > 0) {
    console.log('\nConsider adding test sessions for unvisited routes to improve coverage.');
  }
}

if (unknownRoutes.length > 0) {
  console.log('\n⚠️  Some routes were visited that don\'t exist in the codebase.');
  console.log('   This could indicate:');
  console.log('   - 404 errors in production');
  console.log('   - Outdated links');
  console.log('   - Routes removed from code but still referenced');
}
