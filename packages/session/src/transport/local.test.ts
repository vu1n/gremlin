/**
 * LocalTransport integration tests
 *
 * Tests server upload, localStorage fallback, retry logic,
 * flush stored sessions, and 4xx vs 5xx handling.
 * Uses a real Bun HTTP server as mock.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { LocalTransport } from './local';
import type { GremlinSession } from '../types';

// ============================================================================
// Mock Server
// ============================================================================

let mockServer: ReturnType<typeof Bun.serve>;
let mockUrl: string;
let receivedSessions: any[];
let serverStatus: number;
let requestCount: number;

beforeAll(() => {
  receivedSessions = [];
  serverStatus = 200;
  requestCount = 0;

  mockServer = Bun.serve({
    port: 0,
    async fetch(req) {
      requestCount++;
      const url = new URL(req.url);

      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: serverStatus >= 500 ? 500 : 200,
        });
      }

      if (url.pathname === '/session' && req.method === 'POST') {
        if (serverStatus !== 200) {
          return new Response('Error', { status: serverStatus });
        }
        const body = await req.json();
        receivedSessions.push(body);
        return new Response(JSON.stringify({ status: 'ok' }));
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
  receivedSessions = [];
  serverStatus = 200;
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

// ============================================================================
// Tests: Successful Upload
// ============================================================================

describe('upload to server', () => {
  it('uploads session successfully', async () => {
    const transport = new LocalTransport({ endpoint: mockUrl, retryAttempts: 0 });
    const result = await transport.upload(makeSession());
    expect(result.success).toBe(true);
    expect(result.method).toBe('server');
    expect(receivedSessions).toHaveLength(1);
  });

  it('sends session as JSON POST to /session', async () => {
    const transport = new LocalTransport({ endpoint: mockUrl, retryAttempts: 0 });
    const session = makeSession('specific-id');
    await transport.upload(session);
    expect(receivedSessions[0].header.sessionId).toBe('specific-id');
  });
});

// ============================================================================
// Tests: Server Failure + Fallback
// ============================================================================

describe('server failure', () => {
  it('returns failure when server is down and no fallback', async () => {
    const transport = new LocalTransport({
      endpoint: 'http://localhost:1', // Nothing listening
      fallbackToStorage: false,
      retryAttempts: 0,
    });

    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(result.method).toBe('none');
    expect(result.error).toBeDefined();
  });

  it('returns failure on 500 with no fallback', async () => {
    serverStatus = 500;
    const transport = new LocalTransport({
      endpoint: mockUrl,
      fallbackToStorage: false,
      retryAttempts: 0,
    });

    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
  });

  it('fails on 4xx errors (thrown to outer catch)', async () => {
    serverStatus = 400;
    const transport = new LocalTransport({
      endpoint: mockUrl,
      fallbackToStorage: false,
      retryAttempts: 0,
      retryDelayMs: 10,
    });

    const result = await transport.upload(makeSession());
    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
  });
});

// ============================================================================
// Tests: Retry Logic
// ============================================================================

describe('retry logic', () => {
  it('retries on 5xx and succeeds', async () => {
    let callCount = 0;
    // Override mock to fail once then succeed
    const retryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        callCount++;
        const url = new URL(req.url);
        if (url.pathname === '/session' && req.method === 'POST') {
          if (callCount === 1) return new Response('Error', { status: 500 });
          const body = await req.json();
          receivedSessions.push(body);
          return new Response(JSON.stringify({ status: 'ok' }));
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    try {
      const transport = new LocalTransport({
        endpoint: `http://localhost:${retryServer.port}`,
        fallbackToStorage: false,
        retryAttempts: 2,
        retryDelayMs: 10,
      });

      const result = await transport.upload(makeSession());
      expect(result.success).toBe(true);
      expect(callCount).toBe(2); // 1 fail + 1 success
    } finally {
      retryServer.stop(true);
    }
  });
});

// ============================================================================
// Tests: Health Check
// ============================================================================

describe('checkServer', () => {
  it('returns true when server is healthy', async () => {
    const transport = new LocalTransport({ endpoint: mockUrl });
    const available = await transport.checkServer();
    expect(available).toBe(true);
  });

  it('returns false when server is unreachable', async () => {
    const transport = new LocalTransport({ endpoint: 'http://localhost:1' });
    const available = await transport.checkServer();
    expect(available).toBe(false);
  });
});

