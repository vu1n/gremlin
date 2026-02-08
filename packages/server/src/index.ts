/**
 * Gremlin API - Cloudflare Workers server
 *
 * Session recording storage and retrieval service.
 * Route handlers are shared with the self-hosted server via @gremlin/server-shared.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import type { Env, ErrorResponse } from './types';
import { registerApiRoutes, type StorageAdapter } from '@gremlin/server-shared';
import {
  storeSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionMetadata,
  listSessionsWithPerf,
  getPerformanceAggregation,
  getSessionPerformance,
} from './storage';

/** Constant-time string comparison to prevent timing attacks (length-safe) */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length; // Non-zero if lengths differ
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// Middleware
// ============================================================================

// CORS for browser uploads — reads ALLOWED_ORIGINS env var
app.use('*', async (c, next) => {
  const raw = c.env.ALLOWED_ORIGINS ?? '*';
  const origin = raw === '*' ? '*' : raw.split(',').map((o) => o.trim()).filter(Boolean);
  const handler = cors({
    origin,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-API-Key'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  });
  return handler(c, next);
});

// Compression
app.use('*', compress());

// API Key authentication middleware
const authMiddleware = async (c: any, next: any) => {
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

  // Guard against unconfigured API_KEY
  if (!c.env.API_KEY) {
    return c.json(
      {
        error: {
          code: 'SERVER_ERROR',
          message: 'API key not configured on server',
        },
      } as ErrorResponse,
      500
    );
  }

  // Constant-time comparison to prevent timing attacks
  const keysMatch = timingSafeEqual(apiKey, c.env.API_KEY);

  if (!keysMatch) {
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

// Apply auth to all API routes except root
app.use('/v1/*', authMiddleware);

// ============================================================================
// Health check
// ============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'Gremlin API',
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

// ============================================================================
// API routes (shared with self-hosted server)
// ============================================================================

// CF Workers env is per-request, so the adapter factory creates one from context
function createStorageAdapter(env: Env): StorageAdapter {
  return {
    storeSession: (session) => storeSession(env, session),
    getSession: (id) => getSession(env, id),
    getSessionMetadata: (id) => getSessionMetadata(env, id),
    listSessions: (limit, cursor) => listSessions(env, limit, cursor),
    deleteSession: (id) => deleteSession(env, id),
    listSessionsWithPerf: (opts) => listSessionsWithPerf(env, opts),
    getPerformanceAggregation: () => getPerformanceAggregation(env),
    getSessionPerformance: (id) => getSessionPerformance(env, id),
  };
}

registerApiRoutes(app, (c) => createStorageAdapter(c.env));

export default app;
