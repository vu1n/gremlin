/**
 * Gremlin API - Self-hosted Bun server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import type { GremlinSession } from '@gremlin/session';
import type {
  ServerConfig,
  ErrorResponse,
  SessionUploadResponse,
  SessionDeleteResponse,
} from './types';
import { validateSession } from './types';
import {
  deleteSession,
  getSession,
  getSessionMetadata,
  listSessions,
  storeSession,
  listSessionsWithPerf,
  parsePerfQueryParams,
  getPerformanceAggregation,
  getSessionPerformance,
} from './storage';
import { ensureDataLayout, getConfig } from './config';

export function createApp(config: ServerConfig): Hono {
  const app = new Hono();

  // ============================================================================
  // Middleware
  // ============================================================================

  app.use(
    '*',
    cors({
      origin: config.allowedOrigins,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-API-Key'],
      exposeHeaders: ['Content-Length'],
      maxAge: 86400,
    })
  );

  app.use('*', compress());

  const authMiddleware = async (c: any, next: any) => {
    if (config.disableAuth) {
      await next();
      return;
    }

    const apiKey = c.req.header('X-API-Key');

    if (!apiKey) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing X-API-Key header',
          },
        } as ErrorResponse,
        401
      );
    }

    if (!config.apiKey) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'API key is not configured on server',
          },
        } as ErrorResponse,
        403
      );
    }

    if (apiKey !== config.apiKey) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Invalid API key',
          },
        } as ErrorResponse,
        403
      );
    }

    await next();
  };

  app.use('/v1/*', authMiddleware);

  // ============================================================================
  // Routes
  // ============================================================================

  app.get('/', (c) => {
    return c.json({
      name: 'Gremlin API (self-hosted)',
      version: '0.0.1',
      endpoints: {
        upload: 'POST /v1/sessions',
        get: 'GET /v1/sessions/:id',
        list: 'GET /v1/sessions',
        delete: 'DELETE /v1/sessions/:id',
        performance: 'GET /v1/sessions/:id/performance',
        analyticsPerformance: 'GET /v1/analytics/performance',
      },
    });
  });

  app.get('/health', async (c) => {
    const { sessionCount } = await getMetrics(config);
    return c.json({
      status: 'ok',
      server: 'gremlin-server-node',
      version: '0.0.1',
      sessions: sessionCount,
    });
  });

  app.get('/metrics', async (c) => {
    const metrics = await getMetrics(config);
    return c.json({
      status: 'ok',
      ...metrics,
    });
  });

  // ============================================================================
  // Performance routes
  // ============================================================================

  app.get('/v1/analytics/performance', async (c) => {
    try {
      const aggregation = await getPerformanceAggregation(config);
      return c.json(aggregation);
    } catch (error) {
      console.error('Error aggregating performance:', error);
      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to aggregate performance data',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        500
      );
    }
  });

  app.get('/v1/sessions/:id/performance', async (c) => {
    try {
      const id = c.req.param('id');
      const result = await getSessionPerformance(config, id);

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
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        500
      );
    }
  });

  // ============================================================================
  // Session routes
  // ============================================================================

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

      const sessionId = await storeSession(config, session);

      const size = new TextEncoder().encode(JSON.stringify(session)).length;

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
            details: error instanceof Error ? error.message : 'Unknown error',
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
        const metadata = await getSessionMetadata(config, id);

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

      const session = await getSession(config, id);

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
            details: error instanceof Error ? error.message : 'Unknown error',
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

      // If any perf-related query params are present, use the perf-aware listing
      const hasPerfParams = queryObj.sort || queryObj.order ||
        Object.keys(queryObj).some((k) => k.endsWith('_gt') || k.endsWith('_lt'));

      if (hasPerfParams) {
        const perfOpts = parsePerfQueryParams(queryObj);
        const result = await listSessionsWithPerf(config, perfOpts);
        return c.json(result);
      }

      // Default listing
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

      const result = await listSessions(config, limit, cursor);

      return c.json(result);
    } catch (error) {
      console.error('Error listing sessions:', error);

      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to list sessions',
            details: error instanceof Error ? error.message : 'Unknown error',
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

      const deleted = await deleteSession(config, id);

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
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        500
      );
    }
  });

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
          details: err.message,
        },
      },
      500
    );
  });

  return app;
}

async function getMetrics(config: ServerConfig): Promise<{
  sessionCount: number;
  lastSession?: { id: string; appName: string; platform: string; eventCount: number; uploadedAt: number };
}> {
  const result = await listSessions(config, 1);
  const lastSession = result.sessions[0]
    ? {
        id: result.sessions[0].id,
        appName: result.sessions[0].appName,
        platform: result.sessions[0].platform,
        eventCount: result.sessions[0].eventCount,
        uploadedAt: result.sessions[0].uploadedAt,
      }
    : undefined;

  return {
    sessionCount: result.totalCount ?? result.sessions.length,
    lastSession,
  };
}

const config = getConfig();
ensureDataLayout(config);

const app = createApp(config);

export { app };

const port = config.port;

console.log(`Gremlin self-hosted server listening on :${port}`);

Bun.serve({
  port,
  fetch: app.fetch,
});
