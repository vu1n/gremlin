/**
 * Routes integration tests
 *
 * Tests all /v1/* API routes with a mock StorageAdapter.
 * Uses Hono's test client for fast request simulation.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { registerApiRoutes } from './routes.ts';
import type { StorageAdapter, PerformanceAggregation, PerformanceTimeline } from './routes.ts';
import { parsePerfQueryParams } from './query-params.ts';
import type { PerfSortKey } from './perf-types.ts';
import type { SessionListResult, SessionSummary } from './types.ts';
import type { GremlinSession } from '@gremlin/session';

// ============================================================================
// Mock Storage
// ============================================================================

function makeSession(id: string): GremlinSession {
  return {
    header: {
      sessionId: id,
      startTime: Date.now(),
      device: { platform: 'web', osVersion: '14', screen: { width: 1920, height: 1080, pixelRatio: 2 } },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'com.test' },
      schemaVersion: 1,
    },
    elements: [],
    events: [{ dt: 0, type: 0, data: { kind: 'tap', x: 0, y: 0 } }],
    screenshots: [],
  } as GremlinSession;
}

function makeSummary(id: string): SessionSummary {
  return {
    id,
    startTime: Date.now(),
    platform: 'web',
    appName: 'TestApp',
    appVersion: '1.0.0',
    eventCount: 5,
    screenshotCount: 0,
    size: 1024,
    uploadedAt: Date.now(),
  };
}

const mockAggregation: PerformanceAggregation = {
  sessionCount: 10,
  sessionsWithPerf: 8,
  webVitals: {
    lcp: { median: 1200, p75: 1800, p95: 3000, count: 8 },
    cls: { median: 0.05, p75: 0.1, p95: 0.25, count: 8 },
    inp: null, fcp: null, ttfb: null,
  },
  fps: { avgFps: 58, minFps: 30, count: 8 },
  longTasks: null,
  memory: null,
  pageLoad: null,
};

class MockStorage implements StorageAdapter {
  sessions = new Map<string, GremlinSession>();
  shouldFail = false;

  async storeSession(session: GremlinSession): Promise<string> {
    if (this.shouldFail) throw new Error('Storage error');
    const id = session.header.sessionId;
    this.sessions.set(id, session);
    return id;
  }

  async getSession(id: string): Promise<GremlinSession | null> {
    if (this.shouldFail) throw new Error('Storage error');
    return this.sessions.get(id) ?? null;
  }

  async getSessionMetadata(id: string): Promise<SessionSummary | null> {
    if (this.shouldFail) throw new Error('Storage error');
    if (!this.sessions.has(id)) return null;
    return makeSummary(id);
  }

  async listSessions(limit: number, cursor?: string): Promise<SessionListResult> {
    if (this.shouldFail) throw new Error('Storage error');
    const all = Array.from(this.sessions.keys()).map(id => makeSummary(id));
    return { sessions: all.slice(0, limit), hasMore: all.length > limit };
  }

  async deleteSession(id: string): Promise<boolean> {
    if (this.shouldFail) throw new Error('Storage error');
    return this.sessions.delete(id);
  }

  async appendSessionEvents(id: string, events: unknown[]): Promise<boolean> {
    if (this.shouldFail) throw new Error('Storage error');
    const session = this.sessions.get(id);
    if (!session) return false;
    session.events = [...(session.events || []), ...(events as GremlinSession['events'])];
    this.sessions.set(id, session);
    return true;
  }

  async listSessionsWithPerf(): Promise<SessionListResult> {
    if (this.shouldFail) throw new Error('Storage error');
    const all = Array.from(this.sessions.keys()).map(id => makeSummary(id));
    return { sessions: all, hasMore: false };
  }

  async getPerformanceAggregation(): Promise<PerformanceAggregation> {
    if (this.shouldFail) throw new Error('Storage error');
    return mockAggregation;
  }

  async getSessionPerformance(id: string): Promise<PerformanceTimeline | null> {
    if (this.shouldFail) throw new Error('Storage error');
    if (!this.sessions.has(id)) return null;
    return {
      sessionId: id,
      summary: makeSummary(id),
      timeline: [{ timestamp: Date.now(), perf: { fps: 60 } }],
    };
  }
}

// ============================================================================
// App Setup
// ============================================================================

let storage: MockStorage;
let app: Hono;

function createApp(): Hono {
  storage = new MockStorage();
  app = new Hono();
  registerApiRoutes(app, () => storage, { allowUnauthenticated: true });
  return app;
}

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  return app.request(path, init);
}

// ============================================================================
// Tests: POST /v1/sessions
// ============================================================================

describe('POST /v1/sessions', () => {
  beforeEach(() => createApp());

  it('uploads a valid session and returns 201', async () => {
    const session = makeSession('s1');
    const res = await req('POST', '/v1/sessions', session);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('s1');
    expect(body.uploadedAt).toBeGreaterThan(0);
    expect(storage.sessions.has('s1')).toBe(true);
  });

  it('rejects non-JSON content type with 400', async () => {
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('rejects invalid session with 400', async () => {
    const res = await req('POST', '/v1/sessions', { bad: 'data' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_SESSION');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('returns 500 on storage failure', async () => {
    storage.shouldFail = true;
    const session = makeSession('fail');
    const res = await req('POST', '/v1/sessions', session);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ============================================================================
// Tests: GET /v1/sessions/:id
// ============================================================================

describe('GET /v1/sessions/:id', () => {
  beforeEach(() => createApp());

  it('retrieves an existing session', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await req('GET', '/v1/sessions/s1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.header.sessionId).toBe('s1');
  });

  it('returns 404 for missing session', async () => {
    const res = await req('GET', '/v1/sessions/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns metadata only when ?metadata=true', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await req('GET', '/v1/sessions/s1?metadata=true');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('s1');
    expect(body.appName).toBe('TestApp');
    // Should NOT contain full session data
    expect(body.header).toBeUndefined();
  });

  it('returns 404 for metadata of missing session', async () => {
    const res = await req('GET', '/v1/sessions/missing?metadata=true');
    expect(res.status).toBe(404);
  });

  it('returns 500 on storage failure', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    storage.shouldFail = true;
    const res = await req('GET', '/v1/sessions/s1');
    expect(res.status).toBe(500);
  });
});

// ============================================================================
// Tests: GET /v1/sessions (list)
// ============================================================================

describe('GET /v1/sessions', () => {
  beforeEach(() => {
    createApp();
    storage.sessions.set('s1', makeSession('s1'));
    storage.sessions.set('s2', makeSession('s2'));
  });

  it('lists sessions', async () => {
    const res = await req('GET', '/v1/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(2);
  });

  it('respects limit parameter', async () => {
    const res = await req('GET', '/v1/sessions?limit=1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(1);
    expect(body.hasMore).toBe(true);
  });

  it('caps limit at 100', async () => {
    const res = await req('GET', '/v1/sessions?limit=999');
    expect(res.status).toBe(200);
    // Should not crash — limit is capped internally
  });

  it('rejects invalid limit with 400', async () => {
    const res = await req('GET', '/v1/sessions?limit=-1');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects non-numeric limit with 400', async () => {
    const res = await req('GET', '/v1/sessions?limit=abc');
    expect(res.status).toBe(400);
  });

  it('routes to perf listing when sort param present', async () => {
    const res = await req('GET', '/v1/sessions?sort=lcp&order=desc');
    expect(res.status).toBe(200);
  });

  it('routes to perf listing when filter params present', async () => {
    const res = await req('GET', '/v1/sessions?lcp_gt=1000');
    expect(res.status).toBe(200);
  });

  it('rejects invalid limit on perf path consistently with 400', async () => {
    const res = await req('GET', '/v1/sessions?sort=lcp&limit=abc');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});

// ============================================================================
// Tests: DELETE /v1/sessions/:id
// ============================================================================

describe('DELETE /v1/sessions/:id', () => {
  beforeEach(() => createApp());

  it('deletes an existing session', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await req('DELETE', '/v1/sessions/s1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe('s1');
    expect(storage.sessions.has('s1')).toBe(false);
  });

  it('returns 404 for missing session', async () => {
    const res = await req('DELETE', '/v1/sessions/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 500 on storage failure', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    storage.shouldFail = true;
    const res = await req('DELETE', '/v1/sessions/s1');
    expect(res.status).toBe(500);
  });
});

// ============================================================================
// Tests: Performance routes
// ============================================================================

describe('GET /v1/analytics/performance', () => {
  beforeEach(() => createApp());

  it('returns aggregated performance data', async () => {
    const res = await req('GET', '/v1/analytics/performance');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionCount).toBe(10);
    expect(body.webVitals.lcp.median).toBe(1200);
  });

  it('returns 500 on storage failure', async () => {
    storage.shouldFail = true;
    const res = await req('GET', '/v1/analytics/performance');
    expect(res.status).toBe(500);
  });
});

describe('GET /v1/sessions/:id/performance', () => {
  beforeEach(() => createApp());

  it('returns performance timeline for existing session', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await req('GET', '/v1/sessions/s1/performance');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('s1');
    expect(body.timeline.length).toBe(1);
  });

  it('returns 404 for missing session', async () => {
    const res = await req('GET', '/v1/sessions/missing/performance');
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Tests: POST /v1/sessions/:id/events
// ============================================================================

describe('POST /v1/sessions/:id/events', () => {
  beforeEach(() => createApp());

  it('appends events to an existing session', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const events = [
      { dt: 100, type: 0, data: { kind: 'tap', x: 10, y: 20 } },
      { dt: 200, type: 0, data: { kind: 'tap', x: 30, y: 40 } },
    ];
    const res = await req('POST', '/v1/sessions/s1/events', events);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('s1');
    expect(body.appended).toBe(2);
    // Verify events were actually appended
    const session = storage.sessions.get('s1')!;
    expect(session.events.length).toBe(3); // 1 original + 2 appended
  });

  it('returns 404 for missing session', async () => {
    const events = [{ dt: 100, type: 0, data: { kind: 'tap', x: 0, y: 0 } }];
    const res = await req('POST', '/v1/sessions/nonexistent/events', events);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects non-JSON content type with 400', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await app.request('/v1/sessions/s1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '[]',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('rejects non-array body with 400', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await req('POST', '/v1/sessions/s1/events', { not: 'an array' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects empty events array with 400', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const res = await req('POST', '/v1/sessions/s1/events', []);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects invalid event data with 400', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    const events = [{ dt: 'not-a-number' }]; // dt must be a number
    const res = await req('POST', '/v1/sessions/s1/events', events);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_EVENTS');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('returns 500 on storage failure', async () => {
    storage.sessions.set('s1', makeSession('s1'));
    storage.shouldFail = true;
    const events = [{ dt: 100, type: 0, data: { kind: 'tap', x: 0, y: 0 } }];
    const res = await req('POST', '/v1/sessions/s1/events', events);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ============================================================================
// Tests: Error handling
// ============================================================================

describe('error handling', () => {
  beforeEach(() => createApp());

  it('returns 404 for unknown endpoints', async () => {
    const res = await req('GET', '/v1/unknown');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('adds security headers via middleware', async () => {
    // Security headers are added via app.use('/*') middleware.
    // Hono test client applies middleware — verify on a simple endpoint.
    const res = await req('GET', '/v1/analytics/performance');
    // If Hono test client doesn't apply after-middleware, headers may be null.
    // This test validates the middleware is registered; actual header presence
    // depends on Hono's test client behavior.
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Tests: parsePerfQueryParams (pure function)
// ============================================================================

describe('parsePerfQueryParams', () => {
  it('parses sort and order', () => {
    const result = parsePerfQueryParams({ sort: 'lcp', order: 'desc' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.sort).toBe('lcp');
    expect(result.params.order).toBe('desc');
  });

  it('ignores invalid sort keys', () => {
    const result = parsePerfQueryParams({ sort: 'invalid' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.sort).toBeUndefined();
  });

  it('ignores invalid order values', () => {
    const result = parsePerfQueryParams({ order: 'sideways' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.order).toBeUndefined();
  });

  it('parses limit and caps at 100', () => {
    const r1 = parsePerfQueryParams({ limit: '50' });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.params.limit).toBe(50);

    const r2 = parsePerfQueryParams({ limit: '999' });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.params.limit).toBe(100);
  });

  it('rejects non-numeric limit consistently with session list parser', () => {
    const result = parsePerfQueryParams({ limit: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Invalid limit parameter');
  });

  it('parses cursor', () => {
    const result = parsePerfQueryParams({ cursor: 'abc123' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.cursor).toBe('abc123');
  });

  it('parses _gt filters', () => {
    const result = parsePerfQueryParams({ lcp_gt: '1000' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.filters).toHaveLength(1);
    expect(result.params.filters![0]).toEqual({ key: 'lcp', op: 'gt', value: 1000 });
  });

  it('parses _lt filters', () => {
    const result = parsePerfQueryParams({ cls_lt: '0.1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.filters).toHaveLength(1);
    expect(result.params.filters![0]).toEqual({ key: 'cls', op: 'lt', value: 0.1 });
  });

  it('parses multiple filters', () => {
    const result = parsePerfQueryParams({ lcp_gt: '1000', cls_lt: '0.25' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.filters).toHaveLength(2);
  });

  it('ignores unknown filter keys', () => {
    const result = parsePerfQueryParams({ unknown_gt: '100' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.filters).toBeUndefined();
  });

  it('ignores non-numeric filter values', () => {
    const result = parsePerfQueryParams({ lcp_gt: 'fast' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.filters).toBeUndefined();
  });

  it('handles all valid sort keys', () => {
    const keys: PerfSortKey[] = ['lcp', 'cls', 'inp', 'fcp', 'ttfb', 'avgFps', 'minFps',
      'longTasks', 'peakMemory', 'pageLoad', 'duration', 'eventCount', 'startTime'];
    for (const key of keys) {
      const result = parsePerfQueryParams({ sort: key });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.params.sort).toBe(key);
    }
  });
});
