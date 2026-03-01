/**
 * Shared Helpers — re-export shim
 *
 * Domain logic has moved to commands/shared/.
 * This file re-exports for backward compatibility with external consumers
 * (e.g. the MCP package or other workspace packages).
 */

export { ensureDir, loadSessions } from './commands/shared/sessions.ts';
export { detectProvider, getApiKey } from './commands/shared/ai.ts';
