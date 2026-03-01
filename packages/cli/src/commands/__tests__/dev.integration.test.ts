/**
 * Dev server integration tests
 *
 * Tests the HTTP endpoints of the dev command's Hono-based server.
 * Uses the exported createDevApp() factory so the test exercises the
 * exact same route stack as the real `gremlin dev` command — no more
 * duplicated route logic that can drift.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GremlinSession } from '@gremlin/session';
import { createDevApp } from '../dev.ts';


function makeSession(overrides?: Partial<GremlinSession>): GremlinSession {
  return {
    header: {
      sessionId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: '14.0',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'com.test.app' },
      schemaVersion: 1,
    },
    elements: [],
    events: [
      { dt: 0, type: 0, data: { kind: 'tap', x: 100, y: 200 } },
      { dt: 500, type: 6, data: { kind: 'navigation', navType: 'push', screen: 'Home' } },
    ],
    screenshots: [],
    ...overrides,
  } as GremlinSession;
}


let baseUrl: string;
let server: ReturnType<typeof Bun.serve>;
let sessionsDir: string;
let analyticsDir: string;
let tmpDir: string;

beforeAll(async () => {
  // Create isolated temp directories
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-dev-test-'));
  sessionsDir = join(tmpDir, 'sessions');
  analyticsDir = join(tmpDir, 'analytics');

  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(analyticsDir, { recursive: true });

  // Per-session lock
  const sessionLocks = new Map<string, Promise<unknown>>();
  function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
    const result = prev.catch(() => {}).then(async () => {
      try {
        return await fn();
      } finally {
        if (sessionLocks.get(sessionId) === result) {
          sessionLocks.delete(sessionId);
        }
      }
    });
    sessionLocks.set(sessionId, result);
    return result;
  }

  const app = createDevApp({
    sessionsDir,
    analyticsDir,
    verbose: false,
    jsonMode: false,
    knownSessionIds: new Set<string>(),
    sessionCount: 0,
    withSessionLock,
  });

  server = Bun.serve({
    port: 0, // Random available port
    fetch: app.fetch,
  });

  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});


describe('GET /health', () => {
  it('returns status ok with server info', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.server).toBe('gremlin-dev');
    expect(body.version).toBe('0.0.1');
    expect(typeof body.sessions).toBe('number');
  });

  it('returns CORS headers', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('OPTIONS (CORS preflight)', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/session`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});


describe('POST /session (legacy)', () => {
  it('accepts a valid session and saves to disk', async () => {
    const session = makeSession();
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    // Legacy route forwards to /v1/sessions which returns 201
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(session.header.sessionId);

    // Verify file was written
    const filePath = join(sessionsDir, `${session.header.sessionId}.json`);
    expect(existsSync(filePath)).toBe(true);

    const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(saved.header.sessionId).toBe(session.header.sessionId);
    expect(saved.events).toHaveLength(2);
  });

  it('rejects non-JSON content type with 400', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"not": "json-type"}',
    });

    // Shared route returns 400 for invalid content type
    expect(res.status).toBe(400);
  });

  it('rejects invalid session data with 400', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: { sessionId: '' } }), // Missing required fields
    });

    expect(res.status).toBe(400);
  });

  it('rejects session with missing header', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [], elements: [], screenshots: [] }),
    });

    expect(res.status).toBe(400);
  });

  it('counts unique sessions correctly', async () => {
    const session1 = makeSession();
    const session2 = makeSession();

    // Get baseline count
    const before = await fetch(`${baseUrl}/health`).then(r => r.json());
    const startCount = before.sessions;

    await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session1),
    });

    await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session2),
    });

    // Re-upload session1 (same sessionId) — should not increment count
    await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session1),
    });

    const after = await fetch(`${baseUrl}/health`).then(r => r.json());
    expect(after.sessions).toBe(startCount + 2);
  });

  it('handles session with large dt values (long pauses)', async () => {
    const session = makeSession({
      events: [
        { dt: 0, type: 0, data: { kind: 'tap', x: 0, y: 0 } },
        { dt: 300000, type: 6, data: { kind: 'navigation', navType: 'push', screen: 'Settings' } }, // 5 min pause
      ],
    } as Partial<GremlinSession>);

    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    expect(res.status).toBe(201);
  });
});

describe('POST /v1/sessions', () => {
  it('uploads a session via the shared route', async () => {
    const session = makeSession();
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(session.header.sessionId);
    expect(typeof body.uploadedAt).toBe('number');

    const filePath = join(sessionsDir, `${session.header.sessionId}.json`);
    expect(existsSync(filePath)).toBe(true);
  });
});


describe('POST /session/append (legacy)', () => {
  it('appends events to an existing session', async () => {
    const session = makeSession();
    // First: upload the full session
    await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    // Then: append more events via legacy endpoint
    const res = await fetch(`${baseUrl}/session/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.header.sessionId,
        events: [
          { dt: 100, type: 0, data: { kind: 'tap', x: 50, y: 50 } },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');

    // Verify events were appended
    const filePath = join(sessionsDir, `${session.header.sessionId}.json`);
    const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(saved.events).toHaveLength(3); // 2 original + 1 appended
  });

  it('creates a new session if none exists', async () => {
    const sessionId = `new-append-${Date.now()}`;
    const res = await fetch(`${baseUrl}/session/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        events: [{ dt: 0, type: 0, data: { kind: 'tap', x: 0, y: 0 } }],
      }),
    });

    expect(res.status).toBe(200);

    const filePath = join(sessionsDir, `${sessionId}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('appends rrweb events', async () => {
    const sessionId = `rrweb-append-${Date.now()}`;
    // First append creates session
    await fetch(`${baseUrl}/session/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        rrwebEvents: [{ type: 4, data: {}, timestamp: Date.now() }],
      }),
    });

    // Second append adds more
    await fetch(`${baseUrl}/session/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        rrwebEvents: [{ type: 3, data: {}, timestamp: Date.now() }],
      }),
    });

    const filePath = join(sessionsDir, `${sessionId}.json`);
    const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(saved.rrwebEvents).toHaveLength(2);
  });

  it('rejects non-JSON content type', async () => {
    const res = await fetch(`${baseUrl}/session/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });

    expect(res.status).toBe(415);
  });
});

describe('POST /v1/sessions/:id/events (shared append)', () => {
  it('appends events via shared route', async () => {
    const session = makeSession();
    await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    const res = await fetch(`${baseUrl}/v1/sessions/${session.header.sessionId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { dt: 100, type: 0, data: { kind: 'tap', x: 50, y: 50 } },
      ]),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe(session.header.sessionId);
    expect(body.appended).toBe(1);
  });
});


describe('GET /sessions (legacy)', () => {
  it('lists uploaded sessions', async () => {
    const res = await fetch(`${baseUrl}/sessions`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    // Shared route returns totalCount
    expect(typeof body.totalCount).toBe('number');
    expect(body.totalCount).toBeGreaterThan(0);
  });

  it('returns session metadata fields', async () => {
    // Upload a known session first
    const session = makeSession();
    await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    const res = await fetch(`${baseUrl}/sessions`);
    const body = await res.json();

    // Shared route uses `id` field (not `sessionId`)
    const found = body.sessions.find((s: any) => s.id === session.header.sessionId);
    expect(found).toBeDefined();
    expect(found.platform).toBe('web');
    expect(found.eventCount).toBe(2);
  });
});

describe('GET /v1/sessions', () => {
  it('lists sessions via shared route with cursor pagination', async () => {
    const res = await fetch(`${baseUrl}/v1/sessions?limit=2`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.length).toBeLessThanOrEqual(2);
    expect(typeof body.hasMore).toBe('boolean');
    expect(typeof body.totalCount).toBe('number');
  });
});

describe('GET /v1/sessions/:id', () => {
  it('retrieves a single session', async () => {
    const session = makeSession();
    await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    const res = await fetch(`${baseUrl}/v1/sessions/${session.header.sessionId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.header.sessionId).toBe(session.header.sessionId);
    expect(body.events).toHaveLength(2);
  });

  it('returns 404 for missing session', async () => {
    const res = await fetch(`${baseUrl}/v1/sessions/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/sessions/:id', () => {
  it('deletes an existing session', async () => {
    const session = makeSession();
    await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    const res = await fetch(`${baseUrl}/v1/sessions/${session.header.sessionId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // File should be gone
    const filePath = join(sessionsDir, `${session.header.sessionId}.json`);
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns 404 for missing session', async () => {
    const res = await fetch(`${baseUrl}/v1/sessions/nonexistent-id`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});


describe('Unknown routes', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('returns CORS headers even on 404', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
