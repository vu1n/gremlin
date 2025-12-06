/**
 * Represents a route or page in the application
 */
export interface Route {
  /** The route path (e.g., '/', '/products', '/cart', '/product/[id]') */
  path: string;

  /** Dynamic route parameters extracted from the path (e.g., ['id', 'slug']) */
  params: string[];

  /** Layout group or segment group for file-based routers (e.g., '(tabs)') */
  layoutGroup?: string;

  /** How this route was discovered */
  source: 'file-based' | 'config-based' | 'link-discovered';

  /** Absolute path to the source file */
  filePath: string;

  /** Whether this is a layout file (_layout.tsx) */
  isLayout?: boolean;

  /** Whether this is an index route (index.tsx) */
  isIndex?: boolean;
}

/**
 * Configuration for route extraction
 */
export interface RouteExtractorConfig {
  /** Root directory of the project */
  rootDir: string;

  /** Patterns to exclude from scanning */
  exclude?: string[];

  /** File extensions to consider as route files (default: ['.tsx', '.ts', '.jsx', '.js']) */
  extensions?: string[];

  /** Whether to include layout files in the results (default: true) */
  includeLayouts?: boolean;
}

/**
 * Result of route extraction
 */
export interface RouteExtractionResult {
  /** All discovered routes */
  routes: Route[];

  /** Errors encountered during extraction */
  errors: Array<{
    file: string;
    message: string;
  }>;

  /** Metadata about the extraction */
  metadata: {
    /** Total number of files scanned */
    filesScanned: number;

    /** Timestamp of extraction */
    timestamp: Date;

    /** App directory that was scanned */
    appDir: string;
  };
}
