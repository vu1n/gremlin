import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Hono } from 'hono';
import type { ServerConfig } from './types.ts';
import { createApp } from './index.ts';
import { storeSession } from './storage.ts';
import type { GremlinSession } from '@gremlin/session';

function makeConfig(dataDir: string, overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    port: 0,
    dataDir,
    apiKey: 'test-api-key-123',
    disableAuth: false,
    allowedOrigins: '*',
    ...overrides,
  };
}

function makeSession(overrides?: Partial<GremlinSession>): GremlinSession {
  return {
    header: {
      sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: 'Test OS',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'com.test.app' },
      schemaVersion: 1,
    },
    elements: [],
    events: [
      { dt: 100, type: 0, data: { kind: 'tap' as const, x: 10, y: 20 } },
    ],
    screenshots: [],
    ...overrides,
  };
}

let tmpDir: string;
let config: ServerConfig;
let app: Hono;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gremlin-api-test-'));
  mkdirSync(join(tmpDir, 'sessions'), { recursive: true });
  config = makeConfig(tmpDir);
  app = createApp(config);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Auth middleware
// ============================================================================

describe('auth middleware', () => {
  it('returns 401 when no API key provided', async () => {
    const res = await app.request('/v1/sessions');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when wrong API key provided', async () => {
    const res = await app.request('/v1/sessions', {
      headers: { 'X-API-Key': 'wrong-key' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTH_INVALID');
    expect(body.error.message).toBe('Invalid API key');
  });

  it('allows request with correct API key', async () => {
    const res = await app.request('/v1/sessions', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when server has no API key configured', async () => {
    const noKeyConfig = makeConfig(tmpDir, { apiKey: undefined, disableAuth: false });
    const noKeyApp = createApp(noKeyConfig);

    const res = await noKeyApp.request('/v1/sessions', {
      headers: { 'X-API-Key': 'some-key' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('bypasses auth when DISABLE_AUTH is true', async () => {
    const noAuthConfig = makeConfig(tmpDir, { disableAuth: true });
    const noAuthApp = createApp(noAuthConfig);

    const res = await noAuthApp.request('/v1/sessions');
    expect(res.status).toBe(200);
  });

  it('requires auth for /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(401);
  });

  it('allows /health with correct API key', async () => {
    const res = await app.request('/health', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Root endpoint
// ============================================================================

describe('GET /', () => {
  it('returns API info', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Gremlin API (self-hosted)');
    expect(body.endpoints).toBeDefined();
  });
});

// ============================================================================
// Health endpoint
// ============================================================================

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.server).toBe('gremlin-server-node');
    expect(typeof body.sessions).toBe('number');
  });
});

// ============================================================================
// Metrics endpoint
// ============================================================================

describe('GET /metrics', () => {
  it('returns metrics', async () => {
    const res = await app.request('/metrics', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.sessionCount).toBe('number');
  });
});

// ============================================================================
// Session upload
// ============================================================================

describe('POST /v1/sessions', () => {
  it('returns 201 for valid session', async () => {
    const session = makeSession();
    const body = JSON.stringify(session);
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
        'X-API-Key': 'test-api-key-123',
      },
      body,
    });
    expect(res.status).toBe(201);
    const responseBody = await res.json();
    expect(responseBody.id).toBeTruthy();
    expect(responseBody.uploadedAt).toBeGreaterThan(0);
    expect(responseBody.size).toBeGreaterThan(0);
  });

  it('returns 400 for invalid content type', async () => {
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-API-Key': 'test-api-key-123',
      },
      body: 'hello',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('returns 400 for invalid session data', async () => {
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-api-key-123',
      },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_SESSION');
    expect(body.error.details).toBeInstanceOf(Array);
  });
});

// ============================================================================
// Session retrieval
// ============================================================================

describe('GET /v1/sessions/:id', () => {
  it('returns session by id', async () => {
    const session = makeSession();
    session.header.sessionId = 'get-test-id';
    await storeSession(config, session);

    const res = await app.request('/v1/sessions/get-test-id', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.header.sessionId).toBe('get-test-id');
    expect(body.events.length).toBe(1);
  });

  it('returns 404 for missing session', async () => {
    const res = await app.request('/v1/sessions/nonexistent', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns metadata only when ?metadata=true', async () => {
    const session = makeSession();
    session.header.sessionId = 'meta-only';
    await storeSession(config, session);

    const res = await app.request('/v1/sessions/meta-only?metadata=true', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('meta-only');
    expect(body.platform).toBe('web');
    // metadata-only response should not include full events array
    expect(body.events).toBeUndefined();
  });

  it('returns 404 for metadata of missing session', async () => {
    const res = await app.request('/v1/sessions/missing?metadata=true', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Session listing
// ============================================================================

describe('GET /v1/sessions', () => {
  it('returns empty list initially', async () => {
    const res = await app.request('/v1/sessions', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
    expect(body.totalCount).toBe(0);
  });

  it('returns stored sessions', async () => {
    await storeSession(config, makeSession());
    await storeSession(config, makeSession());

    const res = await app.request('/v1/sessions', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(2);
  });

  it('respects limit parameter', async () => {
    await storeSession(config, makeSession());
    await storeSession(config, makeSession());
    await storeSession(config, makeSession());

    const res = await app.request('/v1/sessions?limit=2', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(2);
    expect(body.hasMore).toBe(true);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await app.request('/v1/sessions?limit=abc', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 for negative limit', async () => {
    const res = await app.request('/v1/sessions?limit=-1', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Session deletion
// ============================================================================

describe('DELETE /v1/sessions/:id', () => {
  it('deletes existing session', async () => {
    const session = makeSession();
    session.header.sessionId = 'to-delete';
    await storeSession(config, session);

    const res = await app.request('/v1/sessions/to-delete', {
      method: 'DELETE',
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe('to-delete');

    // Verify it's actually gone
    const getRes = await app.request('/v1/sessions/to-delete', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for missing session', async () => {
    const res = await app.request('/v1/sessions/nonexistent', {
      method: 'DELETE',
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ============================================================================
// Performance endpoints
// ============================================================================

describe('GET /v1/sessions/:id/performance', () => {
  it('returns performance timeline for session', async () => {
    const session = makeSession({
      events: [
        {
          dt: 100,
          type: 0,
          data: { kind: 'tap' as const, x: 0, y: 0 },
          perf: { fps: 60, memoryUsage: 50 },
        },
      ],
    });
    session.header.sessionId = 'perf-test';
    await storeSession(config, session);

    const res = await app.request('/v1/sessions/perf-test/performance', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('perf-test');
    expect(body.timeline.length).toBe(1);
    expect(body.timeline[0].perf.fps).toBe(60);
  });

  it('returns 404 for missing session', async () => {
    const res = await app.request('/v1/sessions/missing/performance', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/analytics/performance', () => {
  it('returns aggregated performance data', async () => {
    const s1 = makeSession({ performance: { webVitals: { lcp: 2000 } } });
    s1.header.sessionId = 'agg-1';
    const s2 = makeSession({ performance: { webVitals: { lcp: 3000 } } });
    s2.header.sessionId = 'agg-2';
    await storeSession(config, s1);
    await storeSession(config, s2);

    const res = await app.request('/v1/analytics/performance', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionCount).toBe(2);
    expect(body.sessionsWithPerf).toBe(2);
    expect(body.webVitals.lcp).not.toBeNull();
  });

  it('returns empty aggregation with no sessions', async () => {
    const res = await app.request('/v1/analytics/performance', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionCount).toBe(0);
  });
});

// ============================================================================
// Performance-aware session listing
// ============================================================================

describe('GET /v1/sessions with perf params', () => {
  it('sorts by perf metric', async () => {
    const s1 = makeSession({ performance: { webVitals: { lcp: 3000 } } });
    s1.header.sessionId = 'slow';
    const s2 = makeSession({ performance: { webVitals: { lcp: 1000 } } });
    s2.header.sessionId = 'fast';
    await storeSession(config, s1);
    await storeSession(config, s2);

    const res = await app.request('/v1/sessions?sort=lcp&order=asc', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions[0].id).toBe('fast');
    expect(body.sessions[1].id).toBe('slow');
  });

  it('filters by threshold', async () => {
    const s1 = makeSession({ performance: { webVitals: { lcp: 5000 } } });
    s1.header.sessionId = 'high';
    const s2 = makeSession({ performance: { webVitals: { lcp: 500 } } });
    s2.header.sessionId = 'low';
    await storeSession(config, s1);
    await storeSession(config, s2);

    const res = await app.request('/v1/sessions?lcp_gt=2000', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(1);
    expect(body.sessions[0].id).toBe('high');
  });
});

// ============================================================================
// Not found
// ============================================================================

describe('unknown routes', () => {
  it('returns 404 for unknown endpoints', async () => {
    const res = await app.request('/v1/unknown');
    // Auth middleware runs first on /v1/* so will return 401 without key
    const res2 = await app.request('/totally-unknown');
    expect(res2.status).toBe(404);
    const body = await res2.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ============================================================================
// End-to-end: upload then retrieve
// ============================================================================

describe('end-to-end session flow', () => {
  it('uploads, retrieves, lists, and deletes a session', async () => {
    const session = makeSession();
    session.header.sessionId = 'e2e-session';

    // Upload
    const uploadRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-api-key-123',
      },
      body: JSON.stringify(session),
    });
    expect(uploadRes.status).toBe(201);
    const uploaded = await uploadRes.json();
    expect(uploaded.id).toBe('e2e-session');

    // Retrieve
    const getRes = await app.request('/v1/sessions/e2e-session', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(getRes.status).toBe(200);
    const retrieved = await getRes.json();
    expect(retrieved.header.sessionId).toBe('e2e-session');

    // List
    const listRes = await app.request('/v1/sessions', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(listRes.status).toBe(200);
    const listed = await listRes.json();
    expect(listed.sessions.length).toBe(1);
    expect(listed.sessions[0].id).toBe('e2e-session');

    // Delete
    const delRes = await app.request('/v1/sessions/e2e-session', {
      method: 'DELETE',
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    expect(delRes.status).toBe(200);

    // Verify deletion
    const afterDel = await app.request('/v1/sessions', {
      headers: { 'X-API-Key': 'test-api-key-123' },
    });
    const afterDelBody = await afterDel.json();
    expect(afterDelBody.sessions.length).toBe(0);
  });
});
