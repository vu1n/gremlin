import { join, relative, sep } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import type { Route, RouteExtractorConfig, RouteExtractionResult } from '../../types.js';

const DEFAULT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Extracts routes from an Expo Router app directory
 *
 * Expo Router conventions:
 * - index.tsx → / (index route)
 * - about.tsx → /about
 * - [id].tsx → /[id] (dynamic parameter)
 * - (tabs)/ → layout group (not part of URL)
 * - _layout.tsx → layout file (not a route)
 * - product/index.tsx → /product
 * - product/[id].tsx → /product/[id]
 *
 * @param config - Configuration for route extraction
 * @returns RouteExtractionResult with discovered routes
 */
export function extractExpoRoutes(config: RouteExtractorConfig): RouteExtractionResult {
  const appDir = join(config.rootDir, 'app');
  const extensions = config.extensions || DEFAULT_EXTENSIONS;
  const includeLayouts = config.includeLayouts ?? true;

  if (!existsSync(appDir)) {
    return {
      routes: [],
      errors: [{
        file: appDir,
        message: 'App directory not found'
      }],
      metadata: {
        filesScanned: 0,
        timestamp: new Date(),
        appDir
      }
    };
  }

  const routes: Route[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  let filesScanned = 0;

  /**
   * Recursively scan directory for route files
   */
  function scanDirectory(dir: string, layoutGroup?: string) {
    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Check if this is a layout group (e.g., "(tabs)")
          const isLayoutGroup = entry.startsWith('(') && entry.endsWith(')');
          const newLayoutGroup = isLayoutGroup ? entry : layoutGroup;

          // Recurse into subdirectory
          scanDirectory(fullPath, newLayoutGroup);
        } else if (stat.isFile()) {
          // Check if this is a valid route file
          const hasValidExtension = extensions.some(ext => entry.endsWith(ext));
          if (!hasValidExtension) continue;

          filesScanned++;

          // Check if this is a layout file
          const isLayout = entry.startsWith('_layout.');
          if (isLayout && !includeLayouts) continue;

          // Extract route information
          const route = parseRouteFile(fullPath, appDir, layoutGroup, isLayout);
          if (route) {
            routes.push(route);
          }
        }
      }
    } catch (error) {
      errors.push({
        file: dir,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  scanDirectory(appDir);

  return {
    routes: routes.sort((a, b) => a.path.localeCompare(b.path)),
    errors,
    metadata: {
      filesScanned,
      timestamp: new Date(),
      appDir
    }
  };
}

/**
 * Parse a route file and extract route metadata
 */
function parseRouteFile(
  filePath: string,
  appDir: string,
  layoutGroup?: string,
  isLayout?: boolean
): Route | null {
  // Get relative path from app directory
  const relativePath = relative(appDir, filePath);

  // Remove file extension
  const pathWithoutExt = relativePath.replace(/\.(tsx|ts|jsx|js)$/, '');

  // Split into segments
  const segments = pathWithoutExt.split(sep);

  // Remove layout groups from path segments (they don't affect the URL)
  const urlSegments = segments.filter(segment =>
    !segment.startsWith('(') || !segment.endsWith(')')
  );

  // Extract dynamic parameters
  const params: string[] = [];

  // Build the route path
  const pathSegments = urlSegments.map(segment => {
    // Handle index files
    if (segment === 'index' || segment === '_index') {
      return null;
    }

    // Handle layout files
    if (segment.startsWith('_layout')) {
      return null;
    }

    // Handle dynamic parameters [id], [slug], etc.
    const dynamicMatch = segment.match(/^\[([^\]]+)\]$/);
    if (dynamicMatch) {
      const paramName = dynamicMatch[1];
      params.push(paramName);
      return `[${paramName}]`;
    }

    // Handle catch-all parameters [...slug]
    const catchAllMatch = segment.match(/^\[\.\.\.([^\]]+)\]$/);
    if (catchAllMatch) {
      const paramName = catchAllMatch[1];
      params.push(`...${paramName}`);
      return `[...${paramName}]`;
    }

    return segment;
  }).filter(Boolean);

  // Build final path
  const path = '/' + pathSegments.join('/');

  // Check if this is an index route
  const isIndex = filePath.endsWith('/index.tsx') ||
                  filePath.endsWith('/index.ts') ||
                  filePath.endsWith('/index.jsx') ||
                  filePath.endsWith('/index.js') ||
                  pathWithoutExt === 'index';

  return {
    path,
    params,
    layoutGroup,
    source: 'file-based',
    filePath,
    isLayout,
    isIndex
  };
}

/**
 * Utility function to pretty-print routes
 */
export function printRoutes(result: RouteExtractionResult): void {
  console.log('\n=== EXPO ROUTER ROUTES ===\n');

  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.forEach(error => {
      console.log(`  ❌ ${error.file}: ${error.message}`);
    });
    console.log('');
  }

  console.log(`Found ${result.routes.length} routes (scanned ${result.metadata.filesScanned} files):\n`);

  result.routes.forEach(route => {
    const layoutInfo = route.layoutGroup ? ` [group: ${route.layoutGroup}]` : '';
    const typeInfo = route.isLayout ? ' [layout]' : route.isIndex ? ' [index]' : '';
    const paramsInfo = route.params.length > 0 ? ` (params: ${route.params.join(', ')})` : '';

    console.log(`  ${route.path}${paramsInfo}${layoutInfo}${typeInfo}`);
    console.log(`    → ${route.filePath}`);
    console.log('');
  });

  console.log('=== END ROUTES ===\n');
}
