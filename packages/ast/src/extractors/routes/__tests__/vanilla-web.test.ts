/**
 * Tests for vanilla web route extraction
 *
 * Covers:
 * - extractVanillaWebRoutes: extracts routes from HTML files
 * - Reports errors for inaccessible directories
 * - Handles nested directory structures
 * - Discovers link-based routes from <a href="..."> tags
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractVanillaWebRoutes } from '../vanilla-web.ts';

// ============================================================================
// Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'gremlin-vanilla-web-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Basic route extraction
// ============================================================================

describe('extractVanillaWebRoutes', () => {
  test('extracts route from index.html as /', async () => {
    writeFileSync(join(tempDir, 'index.html'), '<html><body>Home</body></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    expect(result.routes.length).toBeGreaterThanOrEqual(1);
    const indexRoute = result.routes.find(r => r.path === '/');
    expect(indexRoute).toBeDefined();
    expect(indexRoute!.source).toBe('file-based');
  });

  test('extracts route from about.html as /about', async () => {
    writeFileSync(join(tempDir, 'about.html'), '<html><body>About</body></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    const aboutRoute = result.routes.find(r => r.path === '/about');
    expect(aboutRoute).toBeDefined();
    expect(aboutRoute!.source).toBe('file-based');
  });

  test('extracts route from nested index.html as /blog', async () => {
    mkdirSync(join(tempDir, 'blog'));
    writeFileSync(join(tempDir, 'blog', 'index.html'), '<html><body>Blog</body></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    const blogRoute = result.routes.find(r => r.path === '/blog');
    expect(blogRoute).toBeDefined();
  });

  test('extracts nested file routes (e.g., /blog/post)', async () => {
    mkdirSync(join(tempDir, 'blog'));
    writeFileSync(join(tempDir, 'blog', 'post.html'), '<html><body>Post</body></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    const postRoute = result.routes.find(r => r.path === '/blog/post');
    expect(postRoute).toBeDefined();
  });

  test('returns empty routes for directory with no HTML files', async () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'nothing here');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    expect(result.routes).toHaveLength(0);
  });

  test('counts files scanned correctly', async () => {
    writeFileSync(join(tempDir, 'index.html'), '<html></html>');
    writeFileSync(join(tempDir, 'about.html'), '<html></html>');
    writeFileSync(join(tempDir, 'contact.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    expect(result.metadata.filesScanned).toBe(3);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('extractVanillaWebRoutes - errors', () => {
  test('reports error for inaccessible directory', async () => {
    const badDir = join(tempDir, 'nonexistent-dir');

    const result = await extractVanillaWebRoutes({ rootDir: badDir, exclude: [] });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].file).toBe(badDir);
    expect(result.errors[0].message).toMatch(/Failed to scan directory|ENOENT/);
  });

  test('metadata includes the root directory', async () => {
    writeFileSync(join(tempDir, 'index.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    expect(result.metadata.appDir).toBe(tempDir);
  });

  test('metadata includes timestamp as a Date', async () => {
    writeFileSync(join(tempDir, 'index.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    expect(result.metadata.timestamp).toBeInstanceOf(Date);
  });
});

// ============================================================================
// Nested directory structures
// ============================================================================

describe('extractVanillaWebRoutes - nested directories', () => {
  test('handles deeply nested HTML files', async () => {
    mkdirSync(join(tempDir, 'docs', 'api', 'v2'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'api', 'v2', 'index.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    const deepRoute = result.routes.find(r => r.path === '/docs/api/v2');
    expect(deepRoute).toBeDefined();
  });

  test('skips node_modules directory', async () => {
    mkdirSync(join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(tempDir, 'node_modules', 'pkg', 'index.html'), '<html></html>');
    writeFileSync(join(tempDir, 'index.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    // Only the top-level index.html should be found
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].path).toBe('/');
  });

  test('respects exclude patterns', async () => {
    mkdirSync(join(tempDir, 'admin'));
    writeFileSync(join(tempDir, 'admin', 'index.html'), '<html></html>');
    writeFileSync(join(tempDir, 'index.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: ['admin'] });

    const adminRoute = result.routes.find(r => r.path === '/admin');
    expect(adminRoute).toBeUndefined();
  });
});

// ============================================================================
// Link-based route discovery
// ============================================================================

describe('extractVanillaWebRoutes - link discovery', () => {
  test('discovers routes from <a href="..."> links', async () => {
    writeFileSync(
      join(tempDir, 'index.html'),
      '<html><body><a href="/pricing">Pricing</a></body></html>'
    );

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    const pricingRoute = result.routes.find(r => r.path === '/pricing');
    expect(pricingRoute).toBeDefined();
    expect(pricingRoute!.source).toBe('link-discovered');
  });

  test('does not duplicate file-based routes from links', async () => {
    writeFileSync(join(tempDir, 'about.html'), '<html></html>');
    writeFileSync(
      join(tempDir, 'index.html'),
      '<html><body><a href="/about">About</a></body></html>'
    );

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    const aboutRoutes = result.routes.filter(r => r.path === '/about');
    expect(aboutRoutes).toHaveLength(1);
    expect(aboutRoutes[0].source).toBe('file-based');
  });

  test('ignores external links (http, https, mailto, tel)', async () => {
    writeFileSync(
      join(tempDir, 'index.html'),
      `<html><body>
        <a href="https://external.com">Ext</a>
        <a href="http://other.com">Other</a>
        <a href="mailto:test@example.com">Email</a>
        <a href="tel:+1234567890">Phone</a>
      </body></html>`
    );

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    // Only the index route from the file itself, no external links
    const nonFileRoutes = result.routes.filter(r => r.source === 'link-discovered');
    expect(nonFileRoutes).toHaveLength(0);
  });

  test('sorts routes with file-based first', async () => {
    writeFileSync(join(tempDir, 'index.html'), '<html><a href="/z-link">Z</a></html>');
    writeFileSync(join(tempDir, 'about.html'), '<html></html>');

    const result = await extractVanillaWebRoutes({ rootDir: tempDir, exclude: [] });

    // File-based routes should come before link-discovered
    const fileRoutes = result.routes.filter(r => r.source === 'file-based');
    const linkRoutes = result.routes.filter(r => r.source === 'link-discovered');

    if (fileRoutes.length > 0 && linkRoutes.length > 0) {
      const firstFileIndex = result.routes.indexOf(fileRoutes[0]);
      const firstLinkIndex = result.routes.indexOf(linkRoutes[0]);
      expect(firstFileIndex).toBeLessThan(firstLinkIndex);
    }
  });
});
