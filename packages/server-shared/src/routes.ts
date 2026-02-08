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

import type { Hono } from 'hono';
import type { GremlinSession, PerformanceSample } from '@gremlin/session';
import type {
  SessionListResult,
  SessionSummary,
  ErrorResponse,
  SessionUploadResponse,
  SessionDeleteResponse,
} from './types';
import { validateSession } from './types';

// ============================================================================
// Performance query types (previously duplicated in both storage modules)
// ============================================================================

export type PerfSortKey =
  | 'lcp' | 'cls' | 'inp' | 'fcp' | 'ttfb'
  | 'avgFps' | 'minFps' | 'longTasks' | 'peakMemory' | 'pageLoad'
  | 'duration' | 'eventCount' | 'startTime';

export interface PerfQueryOptions {
  sort?: PerfSortKey;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  filters?: { key: PerfSortKey; op: 'gt' | 'lt'; value: number }[];
}

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
// parsePerfQueryParams (pure function, no storage dependency)
// ============================================================================

const PERF_FILTER_MAP: Record<string, PerfSortKey> = {
  lcp: 'lcp', cls: 'cls', inp: 'inp', fcp: 'fcp', ttfb: 'ttfb',
  avgFps: 'avgFps', minFps: 'minFps', longTasks: 'longTasks',
  peakMemory: 'peakMemory', pageLoad: 'pageLoad',
  duration: 'duration', eventCount: 'eventCount',
};

function isValidSortKey(key: string): key is PerfSortKey {
  return [
    'lcp', 'cls', 'inp', 'fcp', 'ttfb',
    'avgFps', 'minFps', 'longTasks', 'peakMemory', 'pageLoad',
    'duration', 'eventCount', 'startTime',
  ].includes(key);
}

export function parsePerfQueryParams(query: Record<string, string>): PerfQueryOptions {
  const opts: PerfQueryOptions = {};

  if (query.sort && isValidSortKey(query.sort)) {
    opts.sort = query.sort;
  }
  if (query.order === 'asc' || query.order === 'desc') {
    opts.order = query.order;
  }
  if (query.limit) {
    const parsed = parseInt(query.limit, 10);
    if (!isNaN(parsed) && parsed > 0) opts.limit = Math.min(parsed, 100);
  }
  if (query.cursor) {
    opts.cursor = query.cursor;
  }

  const filters: PerfQueryOptions['filters'] = [];
  for (const [param, val] of Object.entries(query)) {
    const gtMatch = param.match(/^(\w+)_gt$/);
    const ltMatch = param.match(/^(\w+)_lt$/);
    const match = gtMatch || ltMatch;
    if (!match) continue;
    const filterName = match[1];
    const sortKey = PERF_FILTER_MAP[filterName];
    if (!sortKey) continue;
    const num = parseFloat(val);
    if (isNaN(num)) continue;
    filters.push({ key: sortKey, op: gtMatch ? 'gt' : 'lt', value: num });
  }

  if (filters.length > 0) opts.filters = filters;
  return opts;
}

// ============================================================================
// Storage adapter interface
// ============================================================================

export interface StorageAdapter {
  storeSession(session: GremlinSession): Promise<string>;
  getSession(id: string): Promise<GremlinSession | null>;
  getSessionMetadata(id: string): Promise<SessionSummary | null>;
  listSessions(limit: number, cursor?: string): Promise<SessionListResult>;
  deleteSession(id: string): Promise<boolean>;
  listSessionsWithPerf(opts: PerfQueryOptions): Promise<SessionListResult>;
  getPerformanceAggregation(): Promise<PerformanceAggregation>;
  getSessionPerformance(id: string): Promise<PerformanceTimeline | null>;
}

// ============================================================================
// Shared route registration
// ============================================================================

/**
 * Register all /v1/* API routes on a Hono app.
 *
 * Middleware (CORS, auth, compression) and platform-specific routes
 * (health, metrics) are NOT registered here — those stay in each server.
 *
 * @param app - Hono app instance
 * @param getStorage - Factory that returns a StorageAdapter for each request.
 *   CF Workers passes `(c) => adapter(c.env)` since env is per-request.
 *   Self-hosted passes `() => staticAdapter` since config is fixed.
 */
export function registerApiRoutes(
  app: Hono<any>,
  getStorage: (c: any) => StorageAdapter
): void {
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
            // details omitted to avoid leaking internals
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
            // details omitted to avoid leaking internals
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
      // Use Content-Length from request to avoid redundant serialization
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
            // details omitted to avoid leaking internals
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
            // details omitted to avoid leaking internals
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
        const perfOpts = parsePerfQueryParams(queryObj);
        const result = await getStorage(c).listSessionsWithPerf(perfOpts);
        return c.json(result);
      }

      const limitParam = c.req.query('limit');
      const cursor = c.req.query('cursor');

      let limit = 20;

      if (limitParam) {
        const parsed = parseInt(limitParam, 10);
        if (isNaN(parsed) || parsed < 1) {
          return c.json<ErrorResponse>(
            {
              error: {
                code: 'INVALID_REQUEST',
                message: 'Invalid limit parameter',
              },
            },
            400
          );
        }
        limit = Math.min(parsed, 100);
      }

      const result = await getStorage(c).listSessions(limit, cursor);

      return c.json(result);
    } catch (error) {
      console.error('Error listing sessions:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to list sessions',
            // details omitted to avoid leaking internals
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
            // details omitted to avoid leaking internals
          },
        },
        500
      );
    }
  });

  // --------------------------------------------------------------------------
  // Error handlers
  // --------------------------------------------------------------------------

  app.notFound((c) => {
    return c.json<ErrorResponse>(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
        },
      },
      404
    );
  });

  app.onError((err, c) => {
    console.error('Unhandled error:', err);

    return c.json<ErrorResponse>(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      },
      500
    );
  });

  // Add security headers middleware
  app.use('/*', async (c, next) => {
    await next();

    // Security headers for all responses
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Content Security Policy (basic, allow data: for images)
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self';"
    );

    // Referrer Policy
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy (restrict browser features)
    c.header(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
    );
  });
}
