/**
 * Dev server integration tests
 *
 * Tests the HTTP endpoints of the dev command's Bun.serve server.
 * Spins up a real server on a random port, sends requests, verifies responses and file I/O.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GremlinSession } from '@gremlin/session';
import { z } from 'zod';

// ============================================================================
// Test Fixtures
// ============================================================================

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

// ============================================================================
// Server Lifecycle
// ============================================================================

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

  // Import the dev server module and start a server
  // We can't use the `dev()` function directly (it blocks forever),
  // so we replicate the server setup from dev.ts
  const { mkdirSync } = await import('fs');
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(analyticsDir, { recursive: true });

  const { validateSession, validateSessionAppend, formatValidationError } = await import('../session-validation.ts');

  const knownSessionIds = new Set<string>();
  let sessionCount = 0;

  // Per-session lock (same as dev.ts)
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

  server = Bun.serve({
    port: 0, // Random available port
    async fetch(req) {
      const url = new URL(req.url);
      const corsHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        return new Response(
          JSON.stringify({ status: 'ok', server: 'gremlin-dev', version: '0.0.1', sessions: sessionCount }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (url.pathname === '/session' && req.method === 'POST') {
        try {
          const contentType = req.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Unsupported Media Type: expected application/json' }), {
              status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const body = await req.json();
          const session = validateSession(body);

          if (!session.header?.sessionId) {
            return new Response(JSON.stringify({ error: 'Invalid session: missing sessionId' }), {
              status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          if (!knownSessionIds.has(session.header.sessionId)) {
            knownSessionIds.add(session.header.sessionId);
            sessionCount++;
          }

          const sessionFile = join(sessionsDir, `${session.header.sessionId}.json`);
          const { writeFileSync, renameSync } = await import('fs');
          const tempFile = `${sessionFile}.tmp`;
          writeFileSync(tempFile, JSON.stringify(session, null, 2));
          renameSync(tempFile, sessionFile);

          return new Response(
            JSON.stringify({ status: 'ok', sessionId: session.header.sessionId, saved: sessionFile }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (err) {
          const errorMessage = err instanceof Error && err.name === 'ZodError'
            ? formatValidationError(err as unknown as z.ZodError)
            : 'Failed to process session';
          return new Response(JSON.stringify({ error: errorMessage }), {
            status: err instanceof Error && err.name === 'ZodError' ? 400 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (url.pathname === '/session/append' && req.method === 'POST') {
        try {
          const contentType = req.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Unsupported Media Type: expected application/json' }), {
              status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const body = await req.json();
          const appendData = validateSessionAppend(body);
          const { sessionId, events, rrwebEvents } = appendData;

          if (!knownSessionIds.has(sessionId)) {
            knownSessionIds.add(sessionId);
            sessionCount++;
          }

          await withSessionLock(sessionId, async () => {
            const sessionFile = join(sessionsDir, `${sessionId}.json`);
            const { existsSync, writeFileSync, renameSync } = await import('fs');

            let session: any;
            if (existsSync(sessionFile)) {
              const content = await Bun.file(sessionFile).text();
              session = JSON.parse(content);
            } else {
              session = {
                header: { sessionId, startTime: Date.now(), device: { platform: 'web', osVersion: 'unknown', screen: { width: 0, height: 0, pixelRatio: 1 } }, app: { name: 'unknown', version: '0.0.0', identifier: 'unknown' }, schemaVersion: 1 },
                events: [], elements: [], screenshots: [], rrwebEvents: [],
              };
            }

            if (events && Array.isArray(events)) {
              session.events = [...(session.events || []), ...events];
            }
            if (rrwebEvents && Array.isArray(rrwebEvents)) {
              session.rrwebEvents = [...(session.rrwebEvents || []), ...rrwebEvents];
            }

            const tempFile = `${sessionFile}.tmp`;
            writeFileSync(tempFile, JSON.stringify(session, null, 2));
            renameSync(tempFile, sessionFile);
          });

          return new Response(JSON.stringify({ status: 'ok', sessionId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: 'Failed to append to session' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (url.pathname === '/sessions' && req.method === 'GET') {
        try {
          const limit = parseInt(url.searchParams.get('limit') || '50', 10);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);
          const { readdirSync } = await import('fs');
          const files = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
          const sortedFiles = files.sort().reverse().slice(offset, offset + limit);
          const sessions = await Promise.all(
            sortedFiles.map(async (file: string) => {
              const content = await Bun.file(join(sessionsDir, file)).text();
              const s = JSON.parse(content);
              return { sessionId: s.header?.sessionId, startTime: s.header?.startTime, eventCount: s.events?.length || 0, platform: s.header?.device?.platform };
            })
          );
          return new Response(JSON.stringify({ sessions, total: files.length, limit, offset }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch {
          return new Response(JSON.stringify({ sessions: [], total: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    },
  });

  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Tests: Health Check
// ============================================================================

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
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });
});

// ============================================================================
// Tests: POST /session
// ============================================================================

describe('POST /session', () => {
  it('accepts a valid session and saves to disk', async () => {
    const session = makeSession();
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.sessionId).toBe(session.header.sessionId);

    // Verify file was written
    const filePath = join(sessionsDir, `${session.header.sessionId}.json`);
    expect(existsSync(filePath)).toBe(true);

    const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(saved.header.sessionId).toBe(session.header.sessionId);
    expect(saved.events).toHaveLength(2);
  });

  it('rejects non-JSON content type with 415', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"not": "json-type"}',
    });

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain('Unsupported Media Type');
  });

  it('rejects invalid session data with 400', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: { sessionId: '' } }), // Missing required fields
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Validation failed');
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

    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Tests: POST /session/append
// ============================================================================

describe('POST /session/append', () => {
  it('appends events to an existing session', async () => {
    const session = makeSession();
    // First: upload the full session
    await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    // Then: append more events
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

// ============================================================================
// Tests: GET /sessions
// ============================================================================

describe('GET /sessions', () => {
  it('lists uploaded sessions', async () => {
    const res = await fetch(`${baseUrl}/sessions`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThan(0);
  });

  it('respects limit and offset params', async () => {
    const res = await fetch(`${baseUrl}/sessions?limit=1&offset=0`);
    const body = await res.json();

    expect(body.sessions.length).toBeLessThanOrEqual(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });

  it('returns session metadata fields', async () => {
    // Upload a known session first
    const session = makeSession();
    await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });

    const res = await fetch(`${baseUrl}/sessions`);
    const body = await res.json();

    const found = body.sessions.find((s: any) => s.sessionId === session.header.sessionId);
    expect(found).toBeDefined();
    expect(found.platform).toBe('web');
    expect(found.eventCount).toBe(2);
  });
});

// ============================================================================
// Tests: 404
// ============================================================================

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
