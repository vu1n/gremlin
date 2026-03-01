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

// Re-export shared constants from @gremlin/session
export { SCHEMA_VERSION, SDK_VERSION } from '@gremlin/session';
/** @deprecated Use SDK_VERSION from @gremlin/session instead */
export { SDK_VERSION as VERSION } from '@gremlin/session';

// --- Spec types ---
export * from './spec/index.ts';

// --- AI analysis ---
export * from './ai/index.ts';

// --- Generators ---
export * from './generators/index.ts';

// --- Importers ---
export * from './importers/index.ts';
