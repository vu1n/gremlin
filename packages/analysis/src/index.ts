/**
 * @gremlin/analysis - AI analysis and test generation for Gremlin
 *
 * This package contains server-side functionality:
 * - AI flow analyzer (Claude/OpenAI/Gemini)
 * - Test generators (Playwright, Maestro, Fuzz)
 * - Session importers (rrweb, PostHog)
 * - GremlinSpec types
 *
 * Heavy dependencies - NOT suitable for client-side bundling.
 * Use @gremlin/session for client-side SDK.
 */

export const VERSION = '0.0.1';

// GremlinSpec types
export * from './spec/index';

// AI Analysis
export * from './ai/index';

// Test Generators
export * from './generators/index';

// Session Importers
export * from './importers/index';
