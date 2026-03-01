/**
 * Session validation schemas using Zod
 *
 * Re-exports the canonical validation schemas from @gremlin/server-shared.
 * This file previously contained the schema definitions directly; they have
 * been moved to @gremlin/server-shared/src/validation.ts to provide a single
 * source of truth across all packages.
 */

export {
  GremlinSessionSchema,
  SessionAppendSchema,
  validateSessionZod as validateSession,
  safeValidateSession,
  validateSessionAppend,
  formatValidationError,
} from '@gremlin/server-shared';
