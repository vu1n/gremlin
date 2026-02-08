/**
 * Session validation schemas using Zod
 *
 * Prevents malicious JSON injection, DoS attacks, and invalid data
 * from being processed by the dev server and API endpoints.
 */

import { z } from 'zod';
import type { GremlinSession } from '@gremlin/session';

// ============================================================================
// Basic Types
// ============================================================================

const DeviceInfoSchema = z.object({
  platform: z.enum(['web', 'ios', 'android']),
  osVersion: z.string().max(100),
  model: z.string().max(100).optional(),
  screen: z.object({
    width: z.number().int().positive().max(7680), // 8K max
    height: z.number().int().positive().max(7680),
    pixelRatio: z.number().positive().max(10),
  }),
  userAgent: z.string().max(500).optional(),
  locale: z.string().max(20).optional(),
});

const AppInfoSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().max(50),
  build: z.string().max(50).optional(),
  identifier: z.string().max(200),
});

const SessionHeaderSchema = z.object({
  sessionId: z.string().min(1).max(200),
  startTime: z.number().int().positive(),
  endTime: z.number().int().positive().optional(),
  device: DeviceInfoSchema,
  app: AppInfoSchema,
  schemaVersion: z.number().int().positive().max(1000),
});

// ============================================================================
// Events
// ============================================================================

const GremlinEventSchema = z.object({
  dt: z.number().nonnegative(), // No max — long pauses are legitimate
  type: z.number().int().nonnegative().optional(),
  data: z.any().optional(),
  perf: z.any().optional(),
});

// ============================================================================
// Elements
// ============================================================================

const ElementInfoSchema = z.object({
  testId: z.string().max(200).optional(),
  accessibilityLabel: z.string().max(500).optional(),
  text: z.string().max(1000).optional(),
  type: z.string().max(50),
  bounds: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }).optional(),
  cssSelector: z.string().max(500).optional(),
  attributes: z.record(z.string(), z.any()).optional(),
});

// ============================================================================
// Screenshots
// ============================================================================

const ScreenshotSchema = z.object({
  id: z.string().max(200),
  timestamp: z.number().int().positive(),
  format: z.enum(['png', 'jpeg', 'webp']),
  data: z.string().max(10 * 1024 * 1024), // Base64, max 10MB
  isUrl: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  quality: z.number().int().min(0).max(100),
  isDiff: z.boolean(),
  diffFromId: z.string().max(200).optional(),
});

// ============================================================================
// Performance
// ============================================================================

const WebVitalsSchema = z.object({
  lcp: z.number().nonnegative().max(60000).optional(),
  cls: z.number().nonnegative().max(10).optional(),
  inp: z.number().nonnegative().max(60000).optional(),
  fcp: z.number().nonnegative().max(60000).optional(),
  ttfb: z.number().nonnegative().max(60000).optional(),
});

const SessionPerformanceSchema = z.object({
  webVitals: WebVitalsSchema.optional(),
  avgFps: z.number().nonnegative().max(240).optional(),
  minFps: z.number().nonnegative().max(240).optional(),
  longTaskCount: z.number().int().nonnegative().max(10000).optional(),
  longTaskTotalDuration: z.number().nonnegative().max(3600000).optional(), // 1 hour max
  peakMemoryUsage: z.number().nonnegative().max(16 * 1024 * 1024 * 1024).optional(), // 16GB max
  pageLoadTime: z.number().nonnegative().max(300000).optional(), // 5 minutes max
});

// ============================================================================
// Full Session
// ============================================================================

/**
 * Validates a complete Gremlin session
 *
 * This schema prevents:
 * - DoS via deeply nested objects or excessive array lengths
 * - Injection via malicious string content
 * - Invalid data types and ranges
 */
export const GremlinSessionSchema: z.ZodType<{
  header: z.infer<typeof SessionHeaderSchema>;
  elements: z.infer<typeof ElementInfoSchema>[];
  events: z.infer<typeof GremlinEventSchema>[];
  screenshots: z.infer<typeof ScreenshotSchema>[];
  rrwebEvents?: unknown[];
  performance?: z.infer<typeof SessionPerformanceSchema>;
}> = z.object({
  header: SessionHeaderSchema,
  elements: z.array(ElementInfoSchema).max(10000),
  events: z.array(GremlinEventSchema).max(50000), // Max 50k events
  screenshots: z.array(ScreenshotSchema).max(1000), // Max 1000 screenshots
  rrwebEvents: z.array(z.any()).max(100000).optional(), // rrweb events, max 100k
  performance: SessionPerformanceSchema.optional(),
});

// ============================================================================
// Session Append (for streaming uploads)
// ============================================================================

export const SessionAppendSchema = z.object({
  sessionId: z.string().min(1).max(200),
  events: z.array(GremlinEventSchema).max(10000).optional(),
  rrwebEvents: z.array(z.any()).max(100000).optional(),
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a session from an untrusted source
 *
 * @param data - Unknown session data from request body
 * @returns Validated session (cast to GremlinSession for compatibility)
 * @throws ZodError if validation fails
 */
export function validateSession(data: unknown): GremlinSession {
  const validated = GremlinSessionSchema.parse(data);
  // Cast back to GremlinSession since our validation is compatible
  return validated as GremlinSession;
}

/**
 * Safely validate a session, returning null on failure
 *
 * @param data - Unknown session data from request body
 * @returns Validated session or null if invalid
 */
export function safeValidateSession(
  data: unknown
): z.infer<typeof GremlinSessionSchema> | null {
  const result = GremlinSessionSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate session append data
 *
 * @param data - Unknown append data from request body
 * @returns Validated append data
 * @throws ZodError if validation fails
 */
export function validateSessionAppend(data: unknown): z.infer<typeof SessionAppendSchema> {
  return SessionAppendSchema.parse(data);
}

/**
 * Get validation error details for logging
 *
 * @param error - Zod error from failed validation
 * @returns Formatted error message
 */
export function formatValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
  return `Validation failed: ${issues.join(', ')}`;
}
