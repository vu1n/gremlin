/**
 * Shared API route handlers for Gremlin servers.
 *
 * Both the Cloudflare Workers server and the self-hosted Bun server
 * register identical /v1/* route handlers. This module provides a
 * StorageAdapter interface and a registerApiRoutes() factory that
 * wires up all session/performance routes against any adapter.
 *
 * Each server creates its own adapter wrapping platform-specific
 * storage (R2 vs filesystem) and calls registerApiRoutes().
 */

import type { Hono, Context, MiddlewareHandler } from 'hono';
import type { GremlinSession, PerformanceSample } from '@gremlin/session';
import type {
  SessionListResult,
  SessionSummary,
  ErrorResponse,
  SessionUploadResponse,
  SessionDeleteResponse,
} from './types.ts';
import type { PerfQueryOptions } from './perf-types.ts';
import { validateSession } from './types.ts';
import { GremlinEventSchema } from './validation.ts';
import { parsePerfQueryParams, parseSessionListParams } from './query-params.ts';
import { registerErrorHandlers, registerSecurityHeaders } from './middleware.ts';

export interface PerformanceAggregation {
  sessionCount: number;
  sessionsWithPerf: number;
  webVitals: {
    lcp: { median: number; p75: number; p95: number; count: number } | null;
    cls: { median: number; p75: number; p95: number; count: number } | null;
    inp: { median: number; p75: number; p95: number; count: number } | null;
    fcp: { median: number; p75: number; p95: number; count: number } | null;
    ttfb: { median: number; p75: number; p95: number; count: number } | null;
  };
  fps: { avgFps: number; minFps: number; count: number } | null;
  longTasks: { totalCount: number; totalDuration: number; avgPerSession: number; count: number } | null;
  memory: { avgPeak: number; maxPeak: number; count: number } | null;
  pageLoad: { median: number; p75: number; p95: number; count: number } | null;
}

export interface PerformanceTimeline {
  sessionId: string;
  summary: SessionSummary;
  timeline: PerformanceTimelineEntry[];
}

export interface PerformanceTimelineEntry {
  timestamp: number;
  perf: PerformanceSample;
}

// ============================================================================
// Storage adapter interface
// ============================================================================

export interface SessionAppendEventsResponse {
  sessionId: string;
  appended: number;
}

export interface StorageAdapter {
  storeSession(session: GremlinSession): Promise<string>;
  getSession(id: string): Promise<GremlinSession | null>;
  getSessionMetadata(id: string): Promise<SessionSummary | null>;
  listSessions(limit: number, cursor?: string): Promise<SessionListResult>;
  deleteSession(id: string): Promise<boolean>;
  appendSessionEvents(id: string, events: unknown[]): Promise<boolean>;
  listSessionsWithPerf(opts: PerfQueryOptions): Promise<SessionListResult>;
  getPerformanceAggregation(): Promise<PerformanceAggregation>;
  getSessionPerformance(id: string): Promise<PerformanceTimeline | null>;
}

// ============================================================================
// Shared route registration
// ============================================================================

/**
 * Auth options for API route registration.
 *
 * Secure-by-default: callers must either provide an authMiddleware
 * or explicitly opt out with `allowUnauthenticated: true`.
 */
export type ApiRouteAuthOptions =
  | { authMiddleware: MiddlewareHandler }
  | { allowUnauthenticated: true };

/**
 * Register all /v1/* API routes on a Hono app.
 *
 * @param app - Hono app instance
 * @param getStorage - Factory that returns a StorageAdapter for each request.
 *   CF Workers passes `(c) => adapter(c.env)` since env is per-request.
 *   Self-hosted passes `() => staticAdapter` since config is fixed.
 * @param auth - Auth configuration. Must provide either `authMiddleware`
 *   or explicitly declare `allowUnauthenticated: true`.
 */
export function registerApiRoutes<E extends Record<string, unknown> = Record<string, unknown>>(
  app: Hono<E>,
  getStorage: (c: Context<E>) => StorageAdapter,
  auth: ApiRouteAuthOptions
): void {
  if ('authMiddleware' in auth) {
    app.use('/v1/*', auth.authMiddleware);
  }
  // --------------------------------------------------------------------------
  // Performance routes
  // --------------------------------------------------------------------------

  app.get('/v1/analytics/performance', async (c) => {
    try {
      const aggregation = await getStorage(c).getPerformanceAggregation();
      return c.json(aggregation);
    } catch (error) {
      console.error('Error aggregating performance:', error);
      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to aggregate performance data',
          },
        },
        500
      );
    }
  });

  app.get('/v1/sessions/:id/performance', async (c) => {
    try {
      const id = c.req.param('id');
      const result = await getStorage(c).getSessionPerformance(id);

      if (!result) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Session not found',
            },
          },
          404
        );
      }

      return c.json(result);
    } catch (error) {
      console.error('Error getting session performance:', error);
      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to get session performance',
          },
        },
        500
      );
    }
  });

  // --------------------------------------------------------------------------
  // Session routes
  // --------------------------------------------------------------------------

  app.post('/v1/sessions', async (c) => {
    try {
      let sessionData: unknown;
      const contentType = c.req.header('Content-Type') || '';

      if (contentType.includes('application/json')) {
        sessionData = await c.req.json();
      } else {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_CONTENT_TYPE',
              message: 'Content-Type must be application/json',
            },
          },
          400
        );
      }

      const validation = validateSession(sessionData);

      if (!validation.valid) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_SESSION',
              message: 'Session validation failed',
              details: validation.errors,
            },
          },
          400
        );
      }

      const session = sessionData as GremlinSession;
      const sessionId = await getStorage(c).storeSession(session);
      const contentLength = parseInt(c.req.header('content-length') || '0', 10);
      const size = contentLength > 0 ? contentLength : 0;

      return c.json<SessionUploadResponse>(
        {
          id: sessionId,
          uploadedAt: Date.now(),
          size,
        },
        201
      );
    } catch (error) {
      console.error('Error uploading session:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to upload session',
          },
        },
        500
      );
    }
  });

  app.get('/v1/sessions/:id', async (c) => {
    try {
      const id = c.req.param('id');

      if (!id) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: 'Session ID is required',
            },
          },
          400
        );
      }

      const metadataOnly = c.req.query('metadata') === 'true';

      if (metadataOnly) {
        const metadata = await getStorage(c).getSessionMetadata(id);

        if (!metadata) {
          return c.json<ErrorResponse>(
            {
              error: {
                code: 'NOT_FOUND',
                message: 'Session not found',
              },
            },
            404
          );
        }

        return c.json(metadata);
      }

      const session = await getStorage(c).getSession(id);

      if (!session) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Session not found',
            },
          },
          404
        );
      }

      return c.json(session);
    } catch (error) {
      console.error('Error retrieving session:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to retrieve session',
          },
        },
        500
      );
    }
  });

  app.get('/v1/sessions', async (c) => {
    try {
      const queries = c.req.queries();
      const queryObj: Record<string, string> = {};
      for (const [key, values] of Object.entries(queries)) {
        if (values && values.length > 0) queryObj[key] = values[0];
      }

      const hasPerfParams = queryObj.sort || queryObj.order ||
        Object.keys(queryObj).some((k) => k.endsWith('_gt') || k.endsWith('_lt'));

      if (hasPerfParams) {
        const perfResult = parsePerfQueryParams(queryObj);
        if (!perfResult.ok) {
          return c.json<ErrorResponse>(
            {
              error: {
                code: 'INVALID_REQUEST',
                message: perfResult.error,
              },
            },
            400
          );
        }
        const result = await getStorage(c).listSessionsWithPerf(perfResult.params);
        return c.json(result);
      }

      const listResult = parseSessionListParams({
        limit: c.req.query('limit'),
        cursor: c.req.query('cursor'),
      });

      if (!listResult.ok) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: listResult.error,
            },
          },
          400
        );
      }

      const { limit, cursor } = listResult.params;
      const result = await getStorage(c).listSessions(limit, cursor);

      return c.json(result);
    } catch (error) {
      console.error('Error listing sessions:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to list sessions',
          },
        },
        500
      );
    }
  });

  app.delete('/v1/sessions/:id', async (c) => {
    try {
      const id = c.req.param('id');

      if (!id) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: 'Session ID is required',
            },
          },
          400
        );
      }

      const deleted = await getStorage(c).deleteSession(id);

      if (!deleted) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Session not found',
            },
          },
          404
        );
      }

      return c.json<SessionDeleteResponse>({
        deleted: true,
        id,
      });
    } catch (error) {
      console.error('Error deleting session:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to delete session',
          },
        },
        500
      );
    }
  });

  // --------------------------------------------------------------------------
  // Session event append
  // --------------------------------------------------------------------------

  app.post('/v1/sessions/:id/events', async (c) => {
    try {
      const id = c.req.param('id');

      if (!id) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: 'Session ID is required',
            },
          },
          400
        );
      }

      const contentType = c.req.header('Content-Type') || '';

      if (!contentType.includes('application/json')) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_CONTENT_TYPE',
              message: 'Content-Type must be application/json',
            },
          },
          400
        );
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_JSON',
              message: 'Request body must be valid JSON',
            },
          },
          400
        );
      }

      if (!Array.isArray(body)) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: 'Request body must be a JSON array of events',
            },
          },
          400
        );
      }

      if (body.length === 0) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: 'Events array must not be empty',
            },
          },
          400
        );
      }

      // Validate each event against the schema
      const validationErrors: string[] = [];
      for (let i = 0; i < body.length; i++) {
        const result = GremlinEventSchema.safeParse(body[i]);
        if (!result.success) {
          for (const issue of result.error.issues) {
            const path = issue.path.length > 0 ? `events[${i}].${issue.path.join('.')}` : `events[${i}]`;
            validationErrors.push(`${path}: ${issue.message}`);
          }
        }
      }

      if (validationErrors.length > 0) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'INVALID_EVENTS',
              message: 'Event validation failed',
              details: validationErrors,
            },
          },
          400
        );
      }

      const found = await getStorage(c).appendSessionEvents(id, body);

      if (!found) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Session not found',
            },
          },
          404
        );
      }

      return c.json<SessionAppendEventsResponse>({
        sessionId: id,
        appended: body.length,
      });
    } catch (error) {
      console.error('Error appending session events:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to append events to session',
          },
        },
        500
      );
    }
  });

  // --------------------------------------------------------------------------
  // Error handlers & security middleware
  // --------------------------------------------------------------------------

  registerErrorHandlers(app);
  registerSecurityHeaders(app);
}
