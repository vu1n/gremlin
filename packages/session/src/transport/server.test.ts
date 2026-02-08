/**
 * ServerTransport integration tests
 *
 * Tests production upload, API key auth, 4xx/5xx retry logic,
 * trailing slash normalization, and server health checks.
 * Uses a real Bun HTTP server as mock.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { ServerTransport } from './server';
import type { GremlinSession } from '../types';

// ============================================================================
// Mock Server
// ============================================================================

let mockServer: ReturnType<typeof Bun.serve>;
let mockUrl: string;
let lastHeaders: Record<string, string>;
let lastBody: any;
let responseStatus: number;
let requestCount: number;

beforeAll(() => {
  lastHeaders = {};
  lastBody = null;
  responseStatus = 201;
  requestCount = 0;

  mockServer = Bun.serve({
    port: 0,
    async fetch(req) {
      requestCount++;
      const url = new URL(req.url);

      // Capture headers
      lastHeaders = {};
      req.headers.forEach((v, k) => { lastHeaders[k] = v; });

      if (url.pathname === '/') {
        return new Response(JSON.stringify({ status: 'ok' }));
      }

      if (url.pathname === '/v1/sessions' && req.method === 'POST') {
        lastBody = await req.json();

        if (responseStatus !== 201) {
          return new Response(JSON.stringify({ error: 'test error' }), { status: responseStatus });
        }

        return new Response(JSON.stringify({ id: lastBody.header?.sessionId ?? 'unknown' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  mockUrl = `http://localhost:${mockServer.port}`;
});

afterAll(() => {
  mockServer?.stop(true);
});

beforeEach(() => {
  lastHeaders = {};
  lastBody = null;
  responseStatus = 201;
  requestCount = 0;
});

// ============================================================================
// Helpers
// ============================================================================

function makeSession(id?: string): GremlinSession {
  return {
    header: {
      sessionId: id ?? `test-${Date.now()}`,
      startTime: Date.now(),
      device: { platform: 'web', osVersion: '14', screen: { width: 1920, height: 1080, pixelRatio: 2 } },
      app: { name: 'Test', version: '1.0', identifier: 'com.test' },
      schemaVersion: 1,
    },
    elements: [],
    events: [{ dt: 0, type: 0, data: { kind: 'tap', x: 0, y: 0 } }],
    screenshots: [],
  } as GremlinSession;
}

function makeTransport(overrides?: Partial<ConstructorParameters<typeof ServerTransport>[0]>) {
  return new ServerTransport({
    serverUrl: mockUrl,
    apiKey: 'test-key-123',
    retryAttempts: 0,
    retryDelayMs: 10,
    ...overrides,
  });
}

// ============================================================================
// Tests: Successful Upload
// ============================================================================

describe('upload', () => {
  it('uploads session and returns success with sessionId', async () => {
    const transport = makeTransport();
    const result = await transport.upload(makeSession('s1'));
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('s1');
  });

  it('sends X-API-Key header', async () => {
    const transport = makeTransport({ apiKey: 'my-secret-key' });
    await transport.upload(makeSession());
    expect(lastHeaders['x-api-key']).toBe('my-secret-key');
  });

  it('sends Content-Type application/json', async () => {
    const transport = makeTransport();
    await transport.upload(makeSession());
    expect(lastHeaders['content-type']).toBe('application/json');
  });

  it('POSTs to /v1/sessions', async () => {
    const transport = makeTransport();
    const session = makeSession('check-body');
    await transport.upload(session);
    expect(lastBody.header.sessionId).toBe('check-body');
  });
});

// ============================================================================
// Tests: 4xx Errors (No Retry)
// ============================================================================

describe('4xx errors', () => {
  it('returns failure immediately on 400', async () => {
    responseStatus = 400;
    const transport = makeTransport({ retryAttempts: 2 });
    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
    expect(requestCount).toBe(1); // No retries
  });

  it('returns failure immediately on 401', async () => {
    responseStatus = 401;
    const transport = makeTransport({ retryAttempts: 2 });
    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(requestCount).toBe(1);
  });

  it('returns failure immediately on 422', async () => {
    responseStatus = 422;
    const transport = makeTransport({ retryAttempts: 2 });
    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(requestCount).toBe(1);
  });
});

// ============================================================================
// Tests: 5xx Errors (Retry)
// ============================================================================

describe('5xx errors', () => {
  it('retries on 500 and eventually fails', async () => {
    responseStatus = 500;
    const transport = makeTransport({ retryAttempts: 2 });
    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(requestCount).toBe(3); // 1 initial + 2 retries
  });

  it('retries on 503 and succeeds when server recovers', async () => {
    let callCount = 0;
    const retryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        callCount++;
        const url = new URL(req.url);
        if (url.pathname === '/v1/sessions' && req.method === 'POST') {
          if (callCount <= 2) return new Response('Unavailable', { status: 503 });
          const body = await req.json();
          return new Response(JSON.stringify({ id: body.header?.sessionId }), { status: 201 });
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    try {
      const transport = new ServerTransport({
        serverUrl: `http://localhost:${retryServer.port}`,
        apiKey: 'key',
        retryAttempts: 3,
        retryDelayMs: 10,
      });

      const result = await transport.upload(makeSession('retry-success'));
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('retry-success');
      expect(callCount).toBe(3); // 2 fails + 1 success
    } finally {
      retryServer.stop(true);
    }
  });
});

// ============================================================================
// Tests: Network Errors
// ============================================================================

describe('network errors', () => {
  it('returns failure when server unreachable', async () => {
    const transport = new ServerTransport({
      serverUrl: 'http://localhost:1',
      apiKey: 'key',
      retryAttempts: 0,
    });

    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// Tests: URL Normalization
// ============================================================================

describe('URL normalization', () => {
  it('strips trailing slashes from serverUrl', async () => {
    const transport = new ServerTransport({
      serverUrl: `${mockUrl}///`,
      apiKey: 'key',
      retryAttempts: 0,
    });

    const result = await transport.upload(makeSession('slash-test'));
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Tests: checkServer
// ============================================================================

describe('checkServer', () => {
  it('returns true when server responds OK', async () => {
    const transport = makeTransport();
    const ok = await transport.checkServer();
    expect(ok).toBe(true);
  });

  it('sends API key in health check', async () => {
    const transport = makeTransport({ apiKey: 'health-key' });
    await transport.checkServer();
    expect(lastHeaders['x-api-key']).toBe('health-key');
  });

  it('returns false when server unreachable', async () => {
    const transport = new ServerTransport({
      serverUrl: 'http://localhost:1',
      apiKey: 'key',
    });
    const ok = await transport.checkServer();
    expect(ok).toBe(false);
  });
});
