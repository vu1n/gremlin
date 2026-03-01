import type { Hono } from 'hono';
import type { ErrorResponse } from './types.ts';

export function registerErrorHandlers<E extends Record<string, unknown> = Record<string, unknown>>(app: Hono<E>): void {
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
}

export function registerSecurityHeaders<E extends Record<string, unknown> = Record<string, unknown>>(app: Hono<E>): void {
  app.use('/*', async (c, next) => {
    await next();

    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self';"
    );

    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    c.header(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
    );
  });
}
