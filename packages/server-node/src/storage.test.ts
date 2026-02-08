import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GremlinSession } from '@gremlin/session';
import type { ServerConfig, SessionIndexEntry } from './types';
import { validateSession, createSessionSummary } from './types';
import {
  storeSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionMetadata,
  listSessionsWithPerf,
  parsePerfQueryParams,
  getPerformanceAggregation,
  getSessionPerformance,
} from './storage';

function makeConfig(dataDir: string): ServerConfig {
  return {
    port: 0,
    dataDir,
    apiKey: 'test-key',
    disableAuth: true,
    allowedOrigins: '*',
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

function makeSessionWithPerf(
  perfOverrides: GremlinSession['performance']
): GremlinSession {
  return makeSession({ performance: perfOverrides });
}

let tmpDir: string;
let config: ServerConfig;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gremlin-test-'));
  const sessionsDir = join(tmpDir, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  config = makeConfig(tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// storeSession
// ============================================================================

describe('storeSession', () => {
  it('writes session file to disk', async () => {
    const session = makeSession();
    const id = await storeSession(config, session);
    const filePath = join(tmpDir, 'sessions', `${id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('returns the sessionId from header', async () => {
    const session = makeSession();
    session.header.sessionId = 'my-custom-id';
    const id = await storeSession(config, session);
    expect(id).toBe('my-custom-id');
  });

  it('updates the index file', async () => {
    const session = makeSession();
    const id = await storeSession(config, session);
    const indexPath = join(tmpDir, 'index.json');
    expect(existsSync(indexPath)).toBe(true);
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    expect(index[id]).toBeDefined();
    expect(index[id].id).toBe(id);
    expect(index[id].appName).toBe('TestApp');
  });

  it('stores correct session content', async () => {
    const session = makeSession();
    const id = await storeSession(config, session);
    const filePath = join(tmpDir, 'sessions', `${id}.json`);
    const stored = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(stored.header.sessionId).toBe(session.header.sessionId);
    expect(stored.events.length).toBe(session.events.length);
  });

  it('generates an id when header.sessionId is empty', async () => {
    const session = makeSession();
    session.header.sessionId = '';
    const id = await storeSession(config, session);
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// getSession
// ============================================================================

describe('getSession', () => {
  it('reads back a saved session', async () => {
    const session = makeSession();
    const id = await storeSession(config, session);
    const loaded = await getSession(config, id);
    expect(loaded).not.toBeNull();
    expect(loaded!.header.sessionId).toBe(session.header.sessionId);
    expect(loaded!.events.length).toBe(1);
  });

  it('returns null for missing session', async () => {
    const result = await getSession(config, 'nonexistent-id');
    expect(result).toBeNull();
  });
});

// ============================================================================
// listSessions
// ============================================================================

describe('listSessions', () => {
  it('returns empty list when no sessions', async () => {
    const result = await listSessions(config, 10);
    expect(result.sessions).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('returns saved sessions', async () => {
    await storeSession(config, makeSession());
    await storeSession(config, makeSession());
    const result = await listSessions(config, 10);
    expect(result.sessions.length).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it('respects limit parameter', async () => {
    await storeSession(config, makeSession());
    await storeSession(config, makeSession());
    await storeSession(config, makeSession());
    const result = await listSessions(config, 2);
    expect(result.sessions.length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(3);
  });

  it('sorts by uploadedAt descending', async () => {
    const s1 = makeSession();
    s1.header.sessionId = 'first';
    await storeSession(config, s1);
    // Small delay to ensure different uploadedAt
    await new Promise((r) => setTimeout(r, 10));
    const s2 = makeSession();
    s2.header.sessionId = 'second';
    await storeSession(config, s2);

    const result = await listSessions(config, 10);
    expect(result.sessions[0].id).toBe('second');
    expect(result.sessions[1].id).toBe('first');
  });

  it('supports cursor-based pagination', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = makeSession();
      s.header.sessionId = `sess-${i}`;
      await storeSession(config, s);
      ids.push(s.header.sessionId);
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await listSessions(config, 2);
    expect(page1.sessions.length).toBe(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await listSessions(config, 2, page1.cursor);
    expect(page2.sessions.length).toBe(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await listSessions(config, 2, page2.cursor);
    expect(page3.sessions.length).toBe(1);
    expect(page3.hasMore).toBe(false);
  });

  it('includes session summary fields', async () => {
    const session = makeSession();
    session.header.sessionId = 'summary-test';
    await storeSession(config, session);

    const result = await listSessions(config, 10);
    const summary = result.sessions[0];
    expect(summary.id).toBe('summary-test');
    expect(summary.platform).toBe('web');
    expect(summary.appName).toBe('TestApp');
    expect(summary.appVersion).toBe('1.0.0');
    expect(summary.eventCount).toBe(1);
    expect(summary.screenshotCount).toBe(0);
    expect(summary.size).toBeGreaterThan(0);
    expect(summary.uploadedAt).toBeGreaterThan(0);
  });
});

// ============================================================================
// deleteSession
// ============================================================================

describe('deleteSession', () => {
  it('removes session file from disk', async () => {
    const session = makeSession();
    const id = await storeSession(config, session);
    const filePath = join(tmpDir, 'sessions', `${id}.json`);
    expect(existsSync(filePath)).toBe(true);

    const deleted = await deleteSession(config, id);
    expect(deleted).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('removes session from index', async () => {
    const session = makeSession();
    const id = await storeSession(config, session);

    await deleteSession(config, id);

    const indexPath = join(tmpDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    expect(index[id]).toBeUndefined();
  });

  it('returns false for non-existent session', async () => {
    const deleted = await deleteSession(config, 'no-such-id');
    expect(deleted).toBe(false);
  });

  it('index stays consistent after multiple save/delete cycles', async () => {
    const s1 = makeSession();
    s1.header.sessionId = 'keep-1';
    const s2 = makeSession();
    s2.header.sessionId = 'delete-me';
    const s3 = makeSession();
    s3.header.sessionId = 'keep-2';

    await storeSession(config, s1);
    await storeSession(config, s2);
    await storeSession(config, s3);

    await deleteSession(config, 'delete-me');

    const result = await listSessions(config, 10);
    expect(result.totalCount).toBe(2);
    const ids = result.sessions.map((s) => s.id);
    expect(ids).toContain('keep-1');
    expect(ids).toContain('keep-2');
    expect(ids).not.toContain('delete-me');
  });
});

// ============================================================================
// getSessionMetadata
// ============================================================================

describe('getSessionMetadata', () => {
  it('returns metadata for existing session', async () => {
    const session = makeSession();
    session.header.sessionId = 'meta-test';
    await storeSession(config, session);

    const meta = await getSessionMetadata(config, 'meta-test');
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe('meta-test');
    expect(meta!.platform).toBe('web');
    expect(meta!.appName).toBe('TestApp');
  });

  it('returns null for missing session', async () => {
    const meta = await getSessionMetadata(config, 'nonexistent');
    expect(meta).toBeNull();
  });
});

// ============================================================================
// validateSession
// ============================================================================

describe('validateSession', () => {
  it('accepts a valid session', () => {
    const session = makeSession();
    const result = validateSession(session);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-object input', () => {
    const result = validateSession(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Session must be an object');
  });

  it('rejects missing header', () => {
    const result = validateSession({ elements: [], events: [], screenshots: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header');
  });

  it('rejects missing header.sessionId', () => {
    const session = makeSession();
    (session.header as any).sessionId = undefined;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header.sessionId');
  });

  it('rejects missing header.startTime', () => {
    const session = makeSession();
    (session.header as any).startTime = undefined;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header.startTime');
  });

  it('rejects missing header.device', () => {
    const session = makeSession();
    (session.header as any).device = undefined;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header.device');
  });

  it('rejects missing header.app', () => {
    const session = makeSession();
    (session.header as any).app = undefined;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header.app');
  });

  it('rejects missing header.schemaVersion', () => {
    const session = makeSession();
    (session.header as any).schemaVersion = undefined;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header.schemaVersion');
  });

  it('rejects missing elements array', () => {
    const session = makeSession();
    (session as any).elements = 'not-array';
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid elements array');
  });

  it('rejects missing events array', () => {
    const session = makeSession();
    (session as any).events = null;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid events array');
  });

  it('rejects missing screenshots array', () => {
    const session = makeSession();
    (session as any).screenshots = undefined;
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid screenshots array');
  });

  it('reports multiple errors at once', () => {
    const result = validateSession({
      header: { sessionId: 'test' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('allows extra fields (forward compat)', () => {
    const session = makeSession();
    (session as any).customField = 'extra-data';
    const result = validateSession(session);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// createSessionSummary
// ============================================================================

describe('createSessionSummary', () => {
  it('creates summary with correct fields', () => {
    const session = makeSession();
    const summary = createSessionSummary('test-id', session, 1234, 9999);
    expect(summary.id).toBe('test-id');
    expect(summary.platform).toBe('web');
    expect(summary.appName).toBe('TestApp');
    expect(summary.appVersion).toBe('1.0.0');
    expect(summary.eventCount).toBe(1);
    expect(summary.screenshotCount).toBe(0);
    expect(summary.size).toBe(1234);
    expect(summary.uploadedAt).toBe(9999);
  });

  it('computes duration from header times', () => {
    const session = makeSession();
    session.header.startTime = 1000;
    session.header.endTime = 6000;
    const summary = createSessionSummary('test', session, 0, 0);
    expect(summary.duration).toBe(5000);
  });

  it('duration is undefined when endTime missing', () => {
    const session = makeSession();
    session.header.endTime = undefined;
    const summary = createSessionSummary('test', session, 0, 0);
    expect(summary.duration).toBeUndefined();
  });
});

// ============================================================================
// Performance query: parsePerfQueryParams
// ============================================================================

describe('parsePerfQueryParams', () => {
  it('parses sort and order', () => {
    const opts = parsePerfQueryParams({ sort: 'lcp', order: 'asc' });
    expect(opts.sort).toBe('lcp');
    expect(opts.order).toBe('asc');
  });

  it('parses limit and cursor', () => {
    const opts = parsePerfQueryParams({ limit: '10', cursor: 'abc' });
    expect(opts.limit).toBe(10);
    expect(opts.cursor).toBe('abc');
  });

  it('clamps limit to 100', () => {
    const opts = parsePerfQueryParams({ limit: '500' });
    expect(opts.limit).toBe(100);
  });

  it('ignores invalid sort keys', () => {
    const opts = parsePerfQueryParams({ sort: 'invalid_key' });
    expect(opts.sort).toBeUndefined();
  });

  it('parses threshold filters', () => {
    const opts = parsePerfQueryParams({ lcp_gt: '2500', cls_lt: '0.1' });
    expect(opts.filters).toBeDefined();
    expect(opts.filters!.length).toBe(2);
    expect(opts.filters!.find((f) => f.key === 'lcp')?.op).toBe('gt');
    expect(opts.filters!.find((f) => f.key === 'lcp')?.value).toBe(2500);
    expect(opts.filters!.find((f) => f.key === 'cls')?.op).toBe('lt');
    expect(opts.filters!.find((f) => f.key === 'cls')?.value).toBe(0.1);
  });

  it('ignores NaN filter values', () => {
    const opts = parsePerfQueryParams({ lcp_gt: 'not-a-number' });
    expect(opts.filters).toBeUndefined();
  });
});

// ============================================================================
// Performance query: listSessionsWithPerf
// ============================================================================

describe('listSessionsWithPerf', () => {
  it('sorts by perf metric', async () => {
    const s1 = makeSessionWithPerf({ webVitals: { lcp: 3000 } });
    s1.header.sessionId = 'slow-lcp';
    const s2 = makeSessionWithPerf({ webVitals: { lcp: 1000 } });
    s2.header.sessionId = 'fast-lcp';

    await storeSession(config, s1);
    await storeSession(config, s2);

    const result = await listSessionsWithPerf(config, {
      sort: 'lcp',
      order: 'asc',
    });
    expect(result.sessions[0].id).toBe('fast-lcp');
    expect(result.sessions[1].id).toBe('slow-lcp');
  });

  it('filters by threshold', async () => {
    const s1 = makeSessionWithPerf({ webVitals: { lcp: 3000 } });
    s1.header.sessionId = 'high-lcp';
    const s2 = makeSessionWithPerf({ webVitals: { lcp: 500 } });
    s2.header.sessionId = 'low-lcp';

    await storeSession(config, s1);
    await storeSession(config, s2);

    const result = await listSessionsWithPerf(config, {
      filters: [{ key: 'lcp', op: 'gt', value: 2000 }],
    });
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].id).toBe('high-lcp');
  });

  it('entries without perf data are pushed to end when sorting', async () => {
    const s1 = makeSession(); // no perf
    s1.header.sessionId = 'no-perf';
    const s2 = makeSessionWithPerf({ webVitals: { lcp: 1000 } });
    s2.header.sessionId = 'has-perf';

    await storeSession(config, s1);
    await storeSession(config, s2);

    const result = await listSessionsWithPerf(config, {
      sort: 'lcp',
      order: 'asc',
    });
    expect(result.sessions[0].id).toBe('has-perf');
    expect(result.sessions[1].id).toBe('no-perf');
  });
});

// ============================================================================
// Performance aggregation
// ============================================================================

describe('getPerformanceAggregation', () => {
  it('returns zeros when no sessions', async () => {
    const agg = await getPerformanceAggregation(config);
    expect(agg.sessionCount).toBe(0);
    expect(agg.sessionsWithPerf).toBe(0);
    expect(agg.webVitals.lcp).toBeNull();
  });

  it('aggregates web vitals across sessions', async () => {
    const s1 = makeSessionWithPerf({ webVitals: { lcp: 1000, cls: 0.05 } });
    s1.header.sessionId = 'perf-1';
    const s2 = makeSessionWithPerf({ webVitals: { lcp: 3000, cls: 0.2 } });
    s2.header.sessionId = 'perf-2';
    const s3 = makeSessionWithPerf({ webVitals: { lcp: 2000, cls: 0.1 } });
    s3.header.sessionId = 'perf-3';

    await storeSession(config, s1);
    await storeSession(config, s2);
    await storeSession(config, s3);

    const agg = await getPerformanceAggregation(config);
    expect(agg.sessionCount).toBe(3);
    expect(agg.sessionsWithPerf).toBe(3);
    expect(agg.webVitals.lcp).not.toBeNull();
    expect(agg.webVitals.lcp!.count).toBe(3);
    expect(agg.webVitals.lcp!.median).toBe(2000);
    expect(agg.webVitals.cls).not.toBeNull();
    expect(agg.webVitals.cls!.count).toBe(3);
  });

  it('aggregates fps data', async () => {
    const s1 = makeSessionWithPerf({ avgFps: 60, minFps: 30 });
    s1.header.sessionId = 'fps-1';
    const s2 = makeSessionWithPerf({ avgFps: 45, minFps: 20 });
    s2.header.sessionId = 'fps-2';

    await storeSession(config, s1);
    await storeSession(config, s2);

    const agg = await getPerformanceAggregation(config);
    expect(agg.fps).not.toBeNull();
    expect(agg.fps!.avgFps).toBe(52.5);
    expect(agg.fps!.minFps).toBe(20);
    expect(agg.fps!.count).toBe(2);
  });

  it('aggregates long task data', async () => {
    const s1 = makeSessionWithPerf({
      longTaskCount: 5,
      longTaskTotalDuration: 500,
    });
    s1.header.sessionId = 'lt-1';
    const s2 = makeSessionWithPerf({
      longTaskCount: 3,
      longTaskTotalDuration: 200,
    });
    s2.header.sessionId = 'lt-2';

    await storeSession(config, s1);
    await storeSession(config, s2);

    const agg = await getPerformanceAggregation(config);
    expect(agg.longTasks).not.toBeNull();
    expect(agg.longTasks!.totalCount).toBe(8);
    expect(agg.longTasks!.totalDuration).toBe(700);
    expect(agg.longTasks!.avgPerSession).toBe(4);
    expect(agg.longTasks!.count).toBe(2);
  });

  it('aggregates memory data', async () => {
    const s1 = makeSessionWithPerf({ peakMemoryUsage: 100 });
    s1.header.sessionId = 'mem-1';
    const s2 = makeSessionWithPerf({ peakMemoryUsage: 200 });
    s2.header.sessionId = 'mem-2';

    await storeSession(config, s1);
    await storeSession(config, s2);

    const agg = await getPerformanceAggregation(config);
    expect(agg.memory).not.toBeNull();
    expect(agg.memory!.avgPeak).toBe(150);
    expect(agg.memory!.maxPeak).toBe(200);
    expect(agg.memory!.count).toBe(2);
  });
});

// ============================================================================
// getSessionPerformance (timeline)
// ============================================================================

describe('getSessionPerformance', () => {
  it('returns null for missing session', async () => {
    const result = await getSessionPerformance(config, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns timeline from events with perf samples', async () => {
    const session = makeSession({
      events: [
        {
          dt: 100,
          type: 0,
          data: { kind: 'tap' as const, x: 0, y: 0 },
          perf: { fps: 60, memoryUsage: 50 },
        },
        {
          dt: 200,
          type: 0,
          data: { kind: 'tap' as const, x: 10, y: 20 },
        },
        {
          dt: 300,
          type: 0,
          data: { kind: 'tap' as const, x: 5, y: 5 },
          perf: { fps: 45, memoryUsage: 80 },
        },
      ],
    });
    session.header.sessionId = 'perf-timeline';
    await storeSession(config, session);

    const result = await getSessionPerformance(config, 'perf-timeline');
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('perf-timeline');
    expect(result!.timeline.length).toBe(2);
    expect(result!.timeline[0].perf.fps).toBe(60);
    expect(result!.timeline[1].perf.fps).toBe(45);
  });

  it('computes correct absolute timestamps in timeline', async () => {
    const startTime = 10000;
    const session = makeSession({
      events: [
        {
          dt: 100,
          type: 0,
          data: { kind: 'tap' as const, x: 0, y: 0 },
          perf: { fps: 60 },
        },
        {
          dt: 200,
          type: 0,
          data: { kind: 'tap' as const, x: 0, y: 0 },
          perf: { fps: 55 },
        },
      ],
    });
    session.header.startTime = startTime;
    session.header.sessionId = 'timeline-ts';
    await storeSession(config, session);

    const result = await getSessionPerformance(config, 'timeline-ts');
    expect(result!.timeline[0].timestamp).toBe(10100);
    expect(result!.timeline[1].timestamp).toBe(10300);
  });
});
