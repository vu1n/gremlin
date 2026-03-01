/**
 * Tests for middleware functions (error handlers and security headers).
 *
 * Covers:
 * - registerErrorHandlers: 404 not found, 500 internal error
 * - registerSecurityHeaders: security headers on all responses
 *
 * Uses Hono's test client for fast request simulation.
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { registerErrorHandlers, registerSecurityHeaders } from './middleware.ts';

// ============================================================================
// registerErrorHandlers
// ============================================================================

describe('registerErrorHandlers', () => {
  test('returns 404 JSON for unknown routes', async () => {
    const app = new Hono();
    registerErrorHandlers(app);

    const res = await app.request('/nonexistent');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Endpoint not found');
  });

  test('returns 500 JSON for unhandled errors', async () => {
    const app = new Hono();
    app.get('/boom', () => {
      throw new Error('test explosion');
    });
    registerErrorHandlers(app);

    const res = await app.request('/boom');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  test('does not leak error details in 500 response', async () => {
    const app = new Hono();
    app.get('/boom', () => {
      throw new Error('secret internal details');
    });
    registerErrorHandlers(app);

    const res = await app.request('/boom');
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain('secret internal details');
  });
});

// ============================================================================
// registerSecurityHeaders
// ============================================================================

describe('registerSecurityHeaders', () => {
  test('sets all security headers on responses', async () => {
    const app = new Hono();
    registerSecurityHeaders(app);
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
  });

  test('headers are present on all routes', async () => {
    const app = new Hono();
    registerSecurityHeaders(app);
    app.get('/a', (c) => c.text('a'));
    app.get('/b', (c) => c.text('b'));

    const resA = await app.request('/a');
    const resB = await app.request('/b');

    expect(resA.headers.get('X-Frame-Options')).toBe('DENY');
    expect(resB.headers.get('X-Frame-Options')).toBe('DENY');
  });

  test('CSP includes all required directives', async () => {
    const app = new Hono();
    registerSecurityHeaders(app);
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    const csp = res.headers.get('Content-Security-Policy')!;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("font-src 'self'");
  });

  test('Permissions-Policy disables sensitive features', async () => {
    const app = new Hono();
    registerSecurityHeaders(app);
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    const policy = res.headers.get('Permissions-Policy')!;

    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('camera=()');
    expect(policy).toContain('payment=()');
  });
});
