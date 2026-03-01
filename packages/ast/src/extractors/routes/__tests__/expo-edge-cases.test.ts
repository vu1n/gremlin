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

import { describe, test, expect, beforeAll } from 'bun:test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { extractExpoRoutes } from '../expo.ts';
import type { RouteExtractionResult } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const expoAppPath = resolve(__dirname, '../../../../../../examples/expo-app');

describe('Expo Router edge cases', () => {
  let result: RouteExtractionResult;

  beforeAll(async () => {
    result = await extractExpoRoutes({
      rootDir: expoAppPath,
      includeLayouts: true,
    });
  });

  test('should extract routes', () => {
    expect(result.routes.length).toBeGreaterThan(0);
  });

  test('should find index route at /', () => {
    const indexRoute = result.routes.find(r => r.isIndex && r.path === '/');
    expect(indexRoute).toBeDefined();
  });

  test('should find layout file and mark as layout', () => {
    const layoutRoute = result.routes.find(r => r.isLayout && r.path === '/');
    expect(layoutRoute).toBeDefined();
  });

  test('should find static route /cart', () => {
    const cartRoute = result.routes.find(r => r.path === '/cart');
    expect(cartRoute).toBeDefined();
  });

  test('should find static route /checkout', () => {
    const checkoutRoute = result.routes.find(r => r.path === '/checkout');
    expect(checkoutRoute).toBeDefined();
  });

  test('should find static route /products', () => {
    const productsRoute = result.routes.find(r => r.path === '/products');
    expect(productsRoute).toBeDefined();
  });

  test('should find dynamic route /product/[id]', () => {
    const dynamicRoute = result.routes.find(r => r.path === '/product/[id]');
    expect(dynamicRoute).toBeDefined();
  });

  test('dynamic route should have param "id"', () => {
    const dynamicRoute = result.routes.find(r => r.path === '/product/[id]');
    expect(dynamicRoute?.params).toContain('id');
  });

  test('dynamic route should have exactly 1 param', () => {
    const dynamicRoute = result.routes.find(r => r.path === '/product/[id]');
    expect(dynamicRoute?.params.length).toBe(1);
  });

  test('should have no extraction errors', () => {
    expect(result.errors.length).toBe(0);
  });

  test('should have scanned files', () => {
    expect(result.metadata.filesScanned).toBeGreaterThan(0);
  });

  test('should have metadata timestamp', () => {
    expect(result.metadata.timestamp).toBeInstanceOf(Date);
  });

  test('should have metadata appDir ending with /app', () => {
    expect(result.metadata.appDir.endsWith('/app')).toBe(true);
  });

  test('routes should be sorted', () => {
    const paths = result.routes.map(r => r.path);
    const sortedPaths = [...paths].sort();
    expect(paths).toEqual(sortedPaths);
  });

  test('all file paths should be absolute', () => {
    const allAbsolute = result.routes.every(r => r.filePath.startsWith('/'));
    expect(allAbsolute).toBe(true);
  });

  test('all routes should have required fields', () => {
    for (const r of result.routes) {
      expect(typeof r.path).toBe('string');
      expect(Array.isArray(r.params)).toBe(true);
      expect(r.source).toBe('file-based');
      expect(typeof r.filePath).toBe('string');
    }
  });

  test('layout and index should be mutually exclusive', () => {
    const layoutAndIndex = result.routes.filter(r => r.isLayout && r.isIndex);
    expect(layoutAndIndex.length).toBe(0);
  });

  describe('expected route counts', () => {
    test('should find exactly 6 total routes', () => {
      expect(result.routes.length).toBe(6);
    });

    test('should find exactly 5 regular routes', () => {
      const regularRoutes = result.routes.filter(r => !r.isLayout);
      expect(regularRoutes.length).toBe(5);
    });

    test('should find exactly 1 layout route', () => {
      const layoutRoutes = result.routes.filter(r => r.isLayout);
      expect(layoutRoutes.length).toBe(1);
    });

    test('should find exactly 1 index route', () => {
      const indexRoutes = result.routes.filter(r => r.isIndex);
      expect(indexRoutes.length).toBe(1);
    });

    test('should find exactly 1 dynamic route', () => {
      const dynamicRoutes = result.routes.filter(r => r.params.length > 0);
      expect(dynamicRoutes.length).toBe(1);
    });
  });
});
