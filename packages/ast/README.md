# @gremlin/ast

AST analysis and route extraction for Gremlin projects.

## Overview

This package provides tools to extract routes and pages from various web frameworks. The extracted routes can be compared against observed session data to identify coverage gaps and unused routes.

## Features

- **Vanilla Web**: Extract routes from static HTML files and navigation links
- **Expo Router**: Extract file-based routes from Expo Router apps (React Native)
- Unified `Route` interface for cross-framework compatibility
- Deduplication with source prioritization (file-based > link-discovered)

## Installation

```bash
bun add @gremlin/ast
```

## Usage

### Vanilla Web App

Extract routes from a vanilla web app with HTML files:

```typescript
import { extractVanillaWebRoutes } from '@gremlin/ast';

const result = await extractVanillaWebRoutes({
  rootDir: '/path/to/web-app',
  exclude: ['node_modules', 'dist'],
});

console.log(result.routes);
// [
//   { path: '/', params: [], source: 'file-based', filePath: '/path/to/index.html' },
//   { path: '/products', params: [], source: 'file-based', filePath: '/path/to/products.html' },
//   ...
// ]
```

### Expo Router App

Extract routes from an Expo Router app:

```typescript
import { extractExpoRoutes, printRoutes } from '@gremlin/ast';

const result = extractExpoRoutes({
  rootDir: '/path/to/expo-app',
  includeLayouts: true
});

// Pretty print the results
printRoutes(result);

// Access individual routes
result.routes.forEach(route => {
  console.log(`${route.path} -> ${route.filePath}`);
  if (route.params.length > 0) {
    console.log(`  Params: ${route.params.join(', ')}`);
  }
});
```

**Expo Router Conventions:**

| File Pattern | Route Path | Description |
|--------------|------------|-------------|
| `index.tsx` | `/` | Index route |
| `about.tsx` | `/about` | Static route |
| `[id].tsx` | `/[id]` | Dynamic parameter |
| `[...slug].tsx` | `/[...slug]` | Catch-all route |
| `(tabs)/` | - | Layout group (not in URL) |
| `_layout.tsx` | - | Layout file |
| `product/index.tsx` | `/product` | Nested index |
| `product/[id].tsx` | `/product/[id]` | Nested dynamic |

**Example Output:**
```
=== EXPO ROUTER ROUTES ===

Found 6 routes (scanned 6 files):

  / [index]
    → /path/to/app/index.tsx

  / [layout]
    → /path/to/app/_layout.tsx

  /cart
    → /path/to/app/cart.tsx

  /product/[id] (params: id)
    → /path/to/app/product/[id].tsx

=== END ROUTES ===
```

## Route Sources

Routes are discovered from multiple sources:

- **file-based**: Routes discovered by scanning the filesystem (e.g., `index.html`, `app/index.tsx`)
- **config-based**: Routes defined in router configuration files
- **link-discovered**: Routes found by parsing navigation links in HTML/JSX

When a route is discovered from multiple sources, file-based routes take precedence.

## API

### `extractVanillaWebRoutes(config: RouteExtractorConfig): Promise<RouteExtractionResult>`

Extracts routes from a vanilla web app.

**Strategy:**
1. Scans for all `.html` files in the project
2. Parses each HTML file to extract `<a href="...">` links
3. Returns unique routes, preferring file-based over link-discovered

**Config:**
- `rootDir`: Root directory of the project
- `exclude`: Optional array of directory patterns to exclude (e.g., `['node_modules', 'dist']`)

**Returns:**
- `routes`: Array of discovered routes
- `errors`: Array of errors encountered during extraction
- `metadata`: Extraction metadata (filesScanned, timestamp, appDir)

### Route Interface

```typescript
interface Route {
  path: string;           // Route path (e.g., '/', '/products')
  params: string[];       // Dynamic params (e.g., ['id', 'slug'])
  layoutGroup?: string;   // Layout group for file-based routers
  source: 'file-based' | 'config-based' | 'link-discovered';
  filePath: string;       // Absolute path to source file
  isLayout?: boolean;     // Is this a layout file?
  isIndex?: boolean;      // Is this an index route?
}
```

## Testing

Run the vanilla web extractor test:

```bash
bun test-vanilla-web.ts
```

Run the Expo Router extractor test:

```bash
bun run test:routes
# or
bun run src/extractors/routes/expo.test.ts
```

Use the CLI tool:

```bash
bun run cli.ts /path/to/your/expo-app
```

This will extract routes from the specified app directory and print the results.

## Architecture

### Vanilla Web Extractor

The vanilla web extractor uses a two-pass approach:

1. **First pass**: Scan filesystem for `.html` files and create file-based routes
2. **Second pass**: Parse HTML content to extract `<a href="...">` links and add link-discovered routes

Routes are deduplicated using a `Map` keyed by path, with file-based routes taking precedence over link-discovered routes.

### Why Two Passes?

This ensures that:
- All file-based routes are discovered first
- Link-discovered routes don't override file-based routes
- Missing routes (links pointing to non-existent files) are captured

### Expo Router Extractor

The Expo Router extractor uses file system scanning to discover routes:

1. **Scan app directory**: Recursively scan the `app/` directory for route files
2. **Parse file paths**: Convert file paths to route paths using Expo Router conventions
3. **Extract parameters**: Identify dynamic parameters from `[param]` and `[...catchAll]` patterns
4. **Handle layout groups**: Track layout groups `(group)` without including them in URLs
5. **Identify special files**: Mark `_layout.tsx` and `index.tsx` files with metadata

**Key features:**
- No AST parsing required (uses file system only)
- Handles all Expo Router conventions
- Preserves file path information for debugging
- Returns sorted routes for consistent output

## Spec Merger

The spec merger combines AST routes with session data to produce a unified GremlinSpec with coverage analysis.

### Basic Usage

```typescript
import { mergeSpecs, calculateCoverage, detectCycles } from '@gremlin/ast';
import type { GremlinSession } from '@gremlin/core';

// 1. Extract routes from your app
const routes = extractExpoRoutes({ rootDir: './my-app' }).routes;

// 2. Load session data (from recordings, analytics, etc.)
const sessions: GremlinSession[] = loadSessions();

// 3. Merge AST + sessions to create spec
const spec = mergeSpecs(routes, sessions, {
  platform: 'ios',
  appName: 'my-app',
});

// 4. Calculate coverage
const coverage = calculateCoverage(spec);
console.log(`Coverage: ${coverage.coveragePercentage}%`);
console.log(`Unreached states: ${coverage.unreachedStates.length}`);
console.log(`Unexpected flows: ${coverage.unexpectedFlows.length}`);

// 5. Detect cycles
const cycles = detectCycles(sessions);
console.log(`Found ${cycles.length} cycles`);
```

### Source Tracking

Every state and transition is tagged with its source:

- `'ast'` - Found in AST routes but never observed in sessions
- `'session'` - Observed in sessions but not found in AST routes
- `'both'` - Found in AST routes AND observed in sessions

### Coverage Analysis

The coverage analyzer provides:

- **Coverage Percentage**: What % of AST states were actually observed
- **Unreached States**: States defined in code but never visited
- **Unexpected States**: States observed but not in AST (hidden routes, admin panels, etc.)
- **Unexpected Flows**: Transitions between states not implied by AST structure

### Cycle Detection

The cycle detector finds repeating patterns in navigation:

- **Navigation cycles**: Normal back-and-forth (e.g., Home → Products → Home)
- **State cycles**: Same screen revisited (e.g., Settings → Profile → Settings)
- **Error cycles**: Loops with errors (e.g., Checkout → Error → Checkout)

For each cycle, you get:
- The navigation path
- Frequency (how many times it occurred)
- Average and max iterations
- Session IDs where it was observed

### Example

Run the example:

```bash
cd packages/ast
bun run demo:merger
```

This will:
1. Extract routes from `examples/expo-app`
2. Create mock session data with various patterns
3. Merge them and show coverage report
4. Detect and report cycles

### API

#### mergeSpecs

```typescript
function mergeSpecs(
  astRoutes: Route[],
  sessions: GremlinSession[],
  options?: {
    platform?: 'web' | 'ios' | 'android' | 'cross-platform';
    appName?: string;
  }
): GremlinSpecWithSources;
```

#### calculateCoverage

```typescript
function calculateCoverage(spec: GremlinSpecWithSources): CoverageInfo;
```

#### detectCycles

```typescript
function detectCycles(sessions: GremlinSession[]): CycleInfo[];
```

#### formatCoverageReport

```typescript
function formatCoverageReport(coverage: CoverageInfo): string;
```

#### formatCyclesReport

```typescript
function formatCyclesReport(cycles: CycleInfo[]): string;
```

## Future Enhancements

- [ ] Next.js App Router support
- [ ] React Router v6 config-based routing
- [ ] Vue Router support
- [ ] Route metadata extraction (loader/action detection)
- [ ] Code-based route discovery (link analysis in JSX)
- [ ] Nested layout group support
- [ ] Route parameter type inference
