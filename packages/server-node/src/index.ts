/**
 * Gremlin API - Self-hosted Bun server
 *
 * Route handlers are shared with the CF Workers server via @gremlin/server-shared.
 */

import { timingSafeEqual } from 'crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { bodyLimit } from 'hono/body-limit';
import type { ServerConfig, ErrorResponse } from './types';
import { registerApiRoutes, type StorageAdapter } from '@gremlin/server-shared';
import {
  deleteSession,
  getSession,
  getSessionMetadata,
  listSessions,
  storeSession,
  listSessionsWithPerf,
  getPerformanceAggregation,
  getSessionPerformance,
} from './storage';
import { ensureDataLayout, getConfig } from './config';

function createStorageAdapter(config: ServerConfig): StorageAdapter {
  return {
    storeSession: (session) => storeSession(config, session),
    getSession: (id) => getSession(config, id),
    getSessionMetadata: (id) => getSessionMetadata(config, id),
    listSessions: (limit, cursor) => listSessions(config, limit, cursor),
    deleteSession: (id) => deleteSession(config, id),
    listSessionsWithPerf: (opts) => listSessionsWithPerf(config, opts),
    getPerformanceAggregation: () => getPerformanceAggregation(config),
    getSessionPerformance: (id) => getSessionPerformance(config, id),
  };
}

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

  // Limit request body size (50MB max for session uploads)
  app.use('/v1/*', bodyLimit({ maxSize: 50 * 1024 * 1024 }));

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

    const a = Buffer.from(apiKey);
    const b = Buffer.from(config.apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
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
  // Platform-specific routes
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
  // API routes (shared with CF Workers server)
  // ============================================================================

  const storage = createStorageAdapter(config);
  registerApiRoutes(app, () => storage);

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

if (import.meta.main) {
  const config = getConfig();
  ensureDataLayout(config);

  const app = createApp(config);

  console.log(`Gremlin self-hosted server listening on :${config.port}`);

  Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });
}
