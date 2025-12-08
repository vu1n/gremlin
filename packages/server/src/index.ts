/**
 * Gremlin API - Cloudflare Workers server
 *
 * Session recording storage and retrieval service
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import type { GremlinSession } from '@gremlin/session';
import type {
  Env,
  ErrorResponse,
  SessionUploadResponse,
  SessionDeleteResponse,
} from './types';
import { validateSession } from './types';
import {
  storeSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionMetadata,
} from './storage';

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// Middleware
// ============================================================================

// CORS for browser uploads
app.use(
  '*',
  cors({
    origin: '*', // Configure this based on your needs
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-API-Key'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

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

  if (apiKey !== c.env.API_KEY) {
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
// Routes
// ============================================================================

/**
 * Health check / API info
 */
app.get('/', (c) => {
  return c.json({
    name: 'Gremlin API',
    version: '0.0.1',
    endpoints: {
      upload: 'POST /v1/sessions',
      get: 'GET /v1/sessions/:id',
      list: 'GET /v1/sessions',
      delete: 'DELETE /v1/sessions/:id',
    },
  });
});

/**
 * Upload a session
 * POST /v1/sessions
 *
 * Accepts JSON session data (optionally gzipped)
 * Returns session ID and metadata
 */
app.post('/v1/sessions', async (c) => {
  try {
    // Parse request body
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

    // Validate session structure
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

    // Store session in R2
    const sessionId = await storeSession(c.env, session);

    // Calculate size
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

/**
 * Get a session by ID
 * GET /v1/sessions/:id
 *
 * Returns full session data
 */
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

    // Check if metadata-only is requested
    const metadataOnly = c.req.query('metadata') === 'true';

    if (metadataOnly) {
      const metadata = await getSessionMetadata(c.env, id);

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

    // Get full session
    const session = await getSession(c.env, id);

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

/**
 * List sessions with pagination
 * GET /v1/sessions
 *
 * Query params:
 * - limit: Number of sessions to return (default: 20, max: 100)
 * - cursor: Pagination cursor from previous response
 *
 * Returns list of session summaries
 */
app.get('/v1/sessions', async (c) => {
  try {
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
      limit = Math.min(parsed, 100); // Cap at 100
    }

    const result = await listSessions(c.env, limit, cursor);

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

/**
 * Delete a session
 * DELETE /v1/sessions/:id
 *
 * Permanently deletes a session
 */
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

    const deleted = await deleteSession(c.env, id);

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

/**
 * 404 handler
 */
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

/**
 * Error handler
 */
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

export default app;
