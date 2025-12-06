import { readdir, readFile } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import type { Route, RouteExtractorConfig, RouteExtractionResult } from '../../types.js';

/**
 * Extract routes from a vanilla web app (HTML files + links)
 *
 * Strategy:
 * 1. Find all HTML files in the project (file-based routes)
 * 2. Parse each HTML file to find <a href="..."> links (link-discovered routes)
 * 3. Return combined set of unique routes
 */
export async function extractVanillaWebRoutes(
  config: RouteExtractorConfig
): Promise<RouteExtractionResult> {
  const routeMap = new Map<string, Route>();
  const errors: Array<{ file: string; message: string }> = [];
  let filesScanned = 0;

  try {
    // Step 1: Find all HTML files (file-based routes)
    const htmlFiles = await findHtmlFiles(config.rootDir, config.exclude);
    filesScanned = htmlFiles.length;

    // Step 2: First pass - add all file-based routes
    for (const filePath of htmlFiles) {
      try {
        const route = createRouteFromFile(filePath, config.rootDir);
        routeMap.set(route.path, route);
      } catch (err) {
        errors.push({
          file: filePath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 3: Second pass - extract links (link-discovered routes)
    for (const filePath of htmlFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const links = extractLinks(content);

        for (const link of links) {
          // Skip external links
          if (isExternalLink(link)) {
            continue;
          }

          // Normalize the link path
          const normalizedPath = normalizePath(link);

          // Only add if not already discovered as file-based route
          // File-based routes take precedence
          if (!routeMap.has(normalizedPath)) {
            routeMap.set(normalizedPath, {
              path: normalizedPath,
              params: extractParams(normalizedPath),
              source: 'link-discovered',
              filePath, // The file where this link was found
            });
          }
        }
      } catch (err) {
        errors.push({
          file: filePath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    errors.push({
      file: config.rootDir,
      message: `Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Convert map to sorted array
  const routes = Array.from(routeMap.values()).sort((a, b) => {
    // Sort by source (file-based first), then by path
    if (a.source !== b.source) {
      return a.source === 'file-based' ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });

  return {
    routes,
    errors,
    metadata: {
      filesScanned,
      timestamp: new Date(),
      appDir: config.rootDir,
    },
  };
}

/**
 * Recursively find all HTML files in a directory
 */
async function findHtmlFiles(
  dir: string,
  exclude: string[] = []
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip excluded paths
      if (exclude.some(pattern => fullPath.includes(pattern))) {
        continue;
      }

      // Skip common directories to exclude
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.git', '.cache', 'build'].includes(entry.name)) {
          continue;
        }
        // Recurse into subdirectories
        const subFiles = await findHtmlFiles(fullPath, exclude);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Create a Route object from an HTML file
 */
function createRouteFromFile(filePath: string, rootDir: string): Route {
  const relativePath = relative(rootDir, filePath);
  const path = filePathToRoute(relativePath);

  return {
    path,
    params: extractParams(path),
    source: 'file-based',
    filePath,
  };
}

/**
 * Convert file path to route path
 * Examples:
 *   index.html -> /
 *   products.html -> /products
 *   about/index.html -> /about
 *   blog/post.html -> /blog/post
 */
function filePathToRoute(filePath: string): string {
  // Remove .html extension
  let route = filePath.replace(/\.html$/, '');

  // Handle index files
  if (route === 'index' || route.endsWith('/index')) {
    route = route.replace(/\/?index$/, '');
  }

  // Ensure leading slash
  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  // Handle root index
  if (route === '') {
    route = '/';
  }

  return route;
}

/**
 * Extract href links from HTML content using regex
 */
function extractLinks(html: string): string[] {
  const links: string[] = [];

  // Match <a href="..."> and extract href value
  // This regex handles both single and double quotes
  const hrefRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push(href);
    }
  }

  return links;
}

/**
 * Normalize a link path to a route path
 */
function normalizePath(link: string): string {
  // Remove query strings and fragments
  let path = link.split('?')[0].split('#')[0];

  // Remove .html extension if present
  path = path.replace(/\.html$/, '');

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Handle trailing slashes
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Check if a link is external
 */
function isExternalLink(link: string): boolean {
  return (
    link.startsWith('http://') ||
    link.startsWith('https://') ||
    link.startsWith('//') ||
    link.startsWith('mailto:') ||
    link.startsWith('tel:')
  );
}

/**
 * Extract route parameters from a path
 * For vanilla web apps, we look for patterns like /user/:id or /post/[slug]
 */
function extractParams(path: string): string[] {
  const params: string[] = [];

  // Match :param style
  const colonParams = path.match(/:([a-zA-Z0-9_]+)/g);
  if (colonParams) {
    params.push(...colonParams.map(p => p.slice(1)));
  }

  // Match [param] style
  const bracketParams = path.match(/\[([a-zA-Z0-9_]+)\]/g);
  if (bracketParams) {
    params.push(...bracketParams.map(p => p.slice(1, -1)));
  }

  return params;
}
