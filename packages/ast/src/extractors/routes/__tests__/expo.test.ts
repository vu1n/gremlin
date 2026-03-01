/**
 * Unit tests for Expo Router route extraction
 *
 * Uses temp directories to test extraction logic in isolation.
 *
 * Covers:
 * - extractExpoRoutes: extracts routes from expo router structure
 * - Handles missing app directory
 * - Detects dynamic routes, layout groups, index routes
 * - Handles layout files
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractExpoRoutes } from '../expo.ts';

// ============================================================================
// Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'gremlin-expo-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Create a file in the app directory. */
function createAppFile(relativePath: string, content = 'export default function() {}') {
  const fullPath = join(tempDir, 'app', relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

// ============================================================================
// Missing app directory
// ============================================================================

describe('extractExpoRoutes - missing app directory', () => {
  test('returns error when app directory does not exist', async () => {
    const result = await extractExpoRoutes({ rootDir: tempDir });

    expect(result.routes).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('App directory not found');
    expect(result.metadata.filesScanned).toBe(0);
  });
});

// ============================================================================
// Basic route extraction
// ============================================================================

describe('extractExpoRoutes - basic', () => {
  test('extracts index route from app/index.tsx', async () => {
    createAppFile('index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    expect(result.errors).toHaveLength(0);
    const indexRoute = result.routes.find(r => r.path === '/');
    expect(indexRoute).toBeDefined();
    expect(indexRoute!.isIndex).toBe(true);
    expect(indexRoute!.source).toBe('file-based');
  });

  test('extracts named route from app/about.tsx', async () => {
    createAppFile('about.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const aboutRoute = result.routes.find(r => r.path === '/about');
    expect(aboutRoute).toBeDefined();
  });

  test('extracts nested route from app/product/index.tsx', async () => {
    createAppFile('product/index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const productRoute = result.routes.find(r => r.path === '/product');
    expect(productRoute).toBeDefined();
    expect(productRoute!.isIndex).toBe(true);
  });

  test('counts scanned files in metadata', async () => {
    createAppFile('index.tsx');
    createAppFile('about.tsx');
    createAppFile('contact.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    expect(result.metadata.filesScanned).toBe(3);
  });

  test('metadata includes appDir and timestamp', async () => {
    createAppFile('index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    expect(result.metadata.appDir).toBe(join(tempDir, 'app'));
    expect(result.metadata.timestamp).toBeInstanceOf(Date);
  });

  test('routes are sorted alphabetically by path', async () => {
    createAppFile('z-page.tsx');
    createAppFile('a-page.tsx');
    createAppFile('m-page.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const paths = result.routes.map(r => r.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });
});

// ============================================================================
// Dynamic routes
// ============================================================================

describe('extractExpoRoutes - dynamic routes', () => {
  test('detects dynamic route parameter from [id].tsx', async () => {
    createAppFile('product/[id].tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const dynamicRoute = result.routes.find(r => r.path === '/product/[id]');
    expect(dynamicRoute).toBeDefined();
    expect(dynamicRoute!.params).toContain('id');
  });

  test('detects catch-all route from [...slug].tsx', async () => {
    createAppFile('docs/[...slug].tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const catchAllRoute = result.routes.find(r => r.path.includes('[...slug]'));
    expect(catchAllRoute).toBeDefined();
    expect(catchAllRoute!.params).toContain('...slug');
  });

  test('handles multiple dynamic segments', async () => {
    createAppFile('users/[userId]/posts/[postId].tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const route = result.routes.find(r => r.params.length === 2);
    expect(route).toBeDefined();
    expect(route!.params).toContain('userId');
    expect(route!.params).toContain('postId');
  });
});

// ============================================================================
// Layout groups
// ============================================================================

describe('extractExpoRoutes - layout groups', () => {
  test('layout group directory is not part of the URL path', async () => {
    createAppFile('(tabs)/home.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const homeRoute = result.routes.find(r => r.path === '/home');
    expect(homeRoute).toBeDefined();
    // The path should NOT include (tabs)
    expect(homeRoute!.path).not.toContain('(tabs)');
  });

  test('layout group is tracked on the route object', async () => {
    createAppFile('(tabs)/index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const route = result.routes.find(r => r.isIndex);
    expect(route).toBeDefined();
    expect(route!.layoutGroup).toBe('(tabs)');
  });
});

// ============================================================================
// Layout files
// ============================================================================

describe('extractExpoRoutes - layout files', () => {
  test('includes layout files when includeLayouts is true', async () => {
    createAppFile('_layout.tsx');
    createAppFile('index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir, includeLayouts: true });

    const layoutRoute = result.routes.find(r => r.isLayout);
    expect(layoutRoute).toBeDefined();
  });

  test('excludes layout files when includeLayouts is false', async () => {
    createAppFile('_layout.tsx');
    createAppFile('index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir, includeLayouts: false });

    const layoutRoute = result.routes.find(r => r.isLayout);
    expect(layoutRoute).toBeUndefined();
  });

  test('includeLayouts defaults to true', async () => {
    createAppFile('_layout.tsx');
    createAppFile('index.tsx');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    const layoutRoute = result.routes.find(r => r.isLayout);
    expect(layoutRoute).toBeDefined();
  });
});

// ============================================================================
// File extensions
// ============================================================================

describe('extractExpoRoutes - file extensions', () => {
  test('supports .tsx, .ts, .jsx, .js by default', async () => {
    createAppFile('a.tsx');
    createAppFile('b.ts');
    createAppFile('c.jsx');
    createAppFile('d.js');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    expect(result.metadata.filesScanned).toBe(4);
    expect(result.routes.length).toBe(4);
  });

  test('ignores non-route file extensions', async () => {
    createAppFile('index.tsx');
    writeFileSync(join(tempDir, 'app', 'styles.css'), 'body {}');
    writeFileSync(join(tempDir, 'app', 'data.json'), '{}');

    const result = await extractExpoRoutes({ rootDir: tempDir });

    // Only the .tsx file should be scanned
    expect(result.metadata.filesScanned).toBe(1);
  });

  test('supports custom extensions config', async () => {
    createAppFile('page.tsx');
    createAppFile('page.ts');

    const result = await extractExpoRoutes({
      rootDir: tempDir,
      extensions: ['.tsx'],
    });

    expect(result.metadata.filesScanned).toBe(1);
  });
});
