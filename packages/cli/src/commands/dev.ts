/**
 * Dev Command
 *
 * Starts a local development server that receives session recordings
 * from the SDK. This is the zero-config local development workflow.
 *
 * Uses the shared `registerApiRoutes()` from @gremlin/server-shared with a
 * lightweight local-filesystem StorageAdapter, so the /v1/* route surface
 * is identical to production servers.
 *
 * Usage:
 *   gremlin dev              # Starts server on :3334
 *   gremlin dev --port 4000  # Custom port
 */

import {
  existsSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { networkInterfaces } from 'os';
import { ensureDir } from './shared/sessions.ts';
import { type GremlinSession, type SessionAnalytics, type GremlinEvent, SCHEMA_VERSION } from '@gremlin/session';
import { validateSessionAppend } from '../session-validation.ts';
import { outputNdjson, type OutputOptions } from '../output.ts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  registerApiRoutes,
  type StorageAdapter,
  type SessionListResult,
  type SessionSummary,
  type PerformanceAggregation,
  type PerformanceTimeline,
  type PerformanceTimelineEntry,
  createSessionSummary,
  computePerformanceAggregation,
  filterSortPaginate,
  type PerfQueryOptions,
} from '@gremlin/server-shared';

interface DevOptions extends OutputOptions {
  /** Port for dev server */
  port?: number;

  /** Output directory for sessions */
  output?: string;

  /** Verbose logging */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Shared context threaded through route handlers
// ---------------------------------------------------------------------------

interface DevContext {
  sessionsDir: string;
  analyticsDir: string;
  verbose: boolean;
  jsonMode: boolean;
  knownSessionIds: Set<string>;
  sessionCount: number;
  withSessionLock: <T>(sessionId: string, fn: () => Promise<T>) => Promise<T>;
}

// ---------------------------------------------------------------------------
// DevStorageAdapter — implements StorageAdapter against local .gremlin/sessions/
// ---------------------------------------------------------------------------

function createDevStorageAdapter(ctx: DevContext): StorageAdapter {
  return {
    async storeSession(session: GremlinSession): Promise<string> {
      const sessionId = session.header.sessionId;

      if (!ctx.knownSessionIds.has(sessionId)) {
        ctx.knownSessionIds.add(sessionId);
        ctx.sessionCount++;
      }

      // Save session (atomic write)
      const sessionFile = join(ctx.sessionsDir, `${sessionId}.json`);
      const tempFile = `${sessionFile}.tmp`;
      writeFileSync(tempFile, JSON.stringify(session, null, 2));
      renameSync(tempFile, sessionFile);

      // Save analytics sidecar (atomic write)
      const analytics = extractAnalytics(session);
      const analyticsFile = join(ctx.analyticsDir, `${sessionId}.json`);
      const analyticsTemp = `${analyticsFile}.tmp`;
      writeFileSync(analyticsTemp, JSON.stringify(analytics, null, 2));
      renameSync(analyticsTemp, analyticsFile);

      // Dev-specific logging
      if (ctx.jsonMode) {
        outputNdjson({
          event: 'session_received',
          sessionId,
          app: session.header.app?.name || 'unknown',
          platform: session.header.device?.platform || 'unknown',
          eventCount: session.events?.length || 0,
          rrwebEventCount: session.rrwebEvents?.length || 0,
          savedTo: sessionFile,
        });
      } else {
        logSession(session, ctx.sessionCount, ctx.verbose);
      }

      return sessionId;
    },

    async getSession(id: string): Promise<GremlinSession | null> {
      const sessionFile = join(ctx.sessionsDir, `${id}.json`);
      const file = Bun.file(sessionFile);
      if (!(await file.exists())) return null;
      try {
        const content = await file.text();
        return JSON.parse(content) as GremlinSession;
      } catch {
        return null;
      }
    },

    async getSessionMetadata(id: string): Promise<SessionSummary | null> {
      const session = await this.getSession(id);
      if (!session) return null;
      const sessionFile = join(ctx.sessionsDir, `${id}.json`);
      const size = (await Bun.file(sessionFile).exists())
        ? new TextEncoder().encode(JSON.stringify(session)).length
        : 0;
      return createSessionSummary(id, session, size, session.header.startTime);
    },

    async listSessions(limit: number, cursor?: string): Promise<SessionListResult> {
      const files = existsSync(ctx.sessionsDir)
        ? readdirSync(ctx.sessionsDir).filter((f: string) => f.endsWith('.json') && !f.endsWith('.tmp'))
        : [];

      // Build summaries, sorted newest first
      const summaries: SessionSummary[] = [];
      for (const file of files) {
        try {
          const content = await Bun.file(join(ctx.sessionsDir, file)).text();
          const session = JSON.parse(content) as GremlinSession;
          const id = session.header?.sessionId || file.replace('.json', '');
          const size = new TextEncoder().encode(content).length;
          summaries.push(createSessionSummary(id, session, size, session.header.startTime));
        } catch {
          // Skip unparseable files
        }
      }

      summaries.sort((a, b) => b.startTime - a.startTime);

      let startIndex = 0;
      if (cursor) {
        const cursorIndex = summaries.findIndex((s) => s.id === cursor);
        if (cursorIndex >= 0) startIndex = cursorIndex + 1;
      }

      const page = summaries.slice(startIndex, startIndex + limit);
      const nextCursor =
        startIndex + limit < summaries.length && page.length > 0
          ? page[page.length - 1].id
          : undefined;

      return {
        sessions: page,
        cursor: nextCursor,
        hasMore: Boolean(nextCursor),
        totalCount: summaries.length,
      };
    },

    async deleteSession(id: string): Promise<boolean> {
      const sessionFile = join(ctx.sessionsDir, `${id}.json`);
      if (!existsSync(sessionFile)) return false;
      try {
        unlinkSync(sessionFile);
        ctx.knownSessionIds.delete(id);
        ctx.sessionCount = Math.max(0, ctx.sessionCount - 1);
        // Also clean up analytics sidecar if present
        const analyticsFile = join(ctx.analyticsDir, `${id}.json`);
        if (existsSync(analyticsFile)) unlinkSync(analyticsFile);
        return true;
      } catch {
        return false;
      }
    },

    async appendSessionEvents(id: string, events: unknown[]): Promise<boolean> {
      const sessionFile = join(ctx.sessionsDir, `${id}.json`);

      if (!ctx.knownSessionIds.has(id)) {
        ctx.knownSessionIds.add(id);
        ctx.sessionCount++;
      }

      return ctx.withSessionLock(id, async () => {
        let session: GremlinSession;
        if (existsSync(sessionFile)) {
          const content = await Bun.file(sessionFile).text();
          session = JSON.parse(content);
        } else {
          // Create a stub session for append-first workflows
          session = {
            header: {
              sessionId: id,
              startTime: Date.now(),
              device: {
                platform: 'web',
                osVersion: 'unknown',
                screen: { width: 0, height: 0, pixelRatio: 1 },
              },
              app: { name: 'unknown', version: '0.0.0', identifier: 'unknown' },
              schemaVersion: SCHEMA_VERSION,
            },
            events: [],
            elements: [],
            screenshots: [],
            rrwebEvents: [],
          } as unknown as GremlinSession;
        }

        session.events = [...(session.events || []), ...(events as GremlinEvent[])];

        const tempFile = `${sessionFile}.tmp`;
        writeFileSync(tempFile, JSON.stringify(session, null, 2));
        renameSync(tempFile, sessionFile);

        if (ctx.verbose && !ctx.jsonMode) {
          console.log(`  [append] ${id}: +${events.length} events`);
        }

        return true;
      });
    },

    async listSessionsWithPerf(opts: PerfQueryOptions): Promise<SessionListResult> {
      const { sessions: allSessions } = await this.listSessions(Number.MAX_SAFE_INTEGER);
      return filterSortPaginate(allSessions, opts);
    },

    async getPerformanceAggregation(): Promise<PerformanceAggregation> {
      const { sessions: allSessions } = await this.listSessions(Number.MAX_SAFE_INTEGER);
      return computePerformanceAggregation(allSessions);
    },

    async getSessionPerformance(id: string): Promise<PerformanceTimeline | null> {
      const session = await this.getSession(id);
      if (!session) return null;

      const sessionFile = join(ctx.sessionsDir, `${id}.json`);
      const size = new TextEncoder().encode(JSON.stringify(session)).length;
      const summary = createSessionSummary(id, session, size, session.header.startTime);

      const timeline: PerformanceTimelineEntry[] = [];
      let absoluteTime = session.header.startTime;

      for (const event of session.events) {
        absoluteTime += event.dt;
        if (event.perf) {
          timeline.push({ timestamp: absoluteTime, perf: event.perf });
        }
      }

      return { sessionId: id, summary, timeline };
    },
  };
}

// ---------------------------------------------------------------------------
// Response helpers (used by dev-only routes outside registerApiRoutes)
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

function cleanStaleTempFiles(dir: string): void {
  if (!existsSync(dir)) return;
  const staleTemps = readdirSync(dir).filter(f => f.endsWith('.tmp'));
  for (const tmp of staleTemps) {
    try { unlinkSync(join(dir, tmp)); } catch {}
  }
}

function createSessionLock(): <T>(sessionId: string, fn: () => Promise<T>) => Promise<T> {
  const locks = new Map<string, Promise<unknown>>();

  return function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(sessionId) ?? Promise.resolve();
    const result = prev.catch(() => {}).then(async () => {
      try {
        return await fn();
      } finally {
        if (locks.get(sessionId) === result) {
          locks.delete(sessionId);
        }
      }
    });
    locks.set(sessionId, result);
    return result;
  };
}

function initKnownSessions(dir: string): Set<string> {
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    : [];
  return new Set<string>(files.map((f) => f.replace('.json', '')));
}

function logServerBanner(port: number, sessionsDir: string, localIP: string | null): void {
  console.log('');
  console.log('  Gremlin Dev Server');
  console.log('  ==================');
  console.log('');
  console.log(`  Status:     Running`);
  console.log(`  Port:       ${port}`);
  console.log(`  Sessions:   ${sessionsDir}/`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    Local:    http://localhost:${port}`);
  if (localIP) {
    console.log(`    Network:  http://${localIP}:${port}  (for React Native)`);
  }
  console.log('');
  logSessionSummary(sessionsDir);
  console.log('  Waiting for sessions...');
  console.log('  ' + '─'.repeat(40));
  console.log('');
}

// ---------------------------------------------------------------------------
// Hono app factory
// ---------------------------------------------------------------------------

export function createDevApp(ctx: DevContext): Hono {
  const app = new Hono();

  // CORS middleware
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    })
  );

  // -------------------------------------------------------------------------
  // Dev-specific routes (health, metrics, legacy endpoints)
  // -------------------------------------------------------------------------

  app.get('/', (c) => {
    return c.json({
      status: 'ok',
      server: 'gremlin-dev',
      version: '0.0.1',
      sessions: ctx.sessionCount,
    });
  });

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      server: 'gremlin-dev',
      version: '0.0.1',
      sessions: ctx.sessionCount,
    });
  });

  app.get('/metrics', (c) => {
    const metrics = getMetrics(ctx.sessionsDir);
    return c.json({ status: 'ok', ...metrics });
  });

  // Legacy /session endpoint — deprecated, proxies to the shared upload route
  app.post('/session', async (c) => {
    console.warn('Deprecation: Use /v1/* endpoints instead of legacy /session* routes');
    // Forward to shared /v1/sessions handler by rewriting
    const body = await c.req.raw.clone().text();
    const url = new URL(c.req.url);
    url.pathname = '/v1/sessions';
    const forwarded = new Request(url.toString(), {
      method: 'POST',
      headers: c.req.raw.headers,
      body,
    });
    return app.fetch(forwarded);
  });

  // Legacy /session/append — deprecated, uses the old append-with-body format
  app.post('/session/append', async (c) => {
    console.warn('Deprecation: Use /v1/* endpoints instead of legacy /session* routes');
    try {
      const contentType = c.req.header('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return c.json({ error: 'Unsupported Media Type: expected application/json' }, 415);
      }

      const body = await c.req.json();
      const appendData = validateSessionAppend(body);
      const { sessionId, events, rrwebEvents } = appendData;

      if (!ctx.knownSessionIds.has(sessionId)) {
        ctx.knownSessionIds.add(sessionId);
        ctx.sessionCount++;
      }

      await ctx.withSessionLock(sessionId, async () => {
        const sessionFile = join(ctx.sessionsDir, `${sessionId}.json`);

        let session: GremlinSession;
        if (existsSync(sessionFile)) {
          const content = await Bun.file(sessionFile).text();
          session = JSON.parse(content);
        } else {
          session = {
            header: {
              sessionId,
              startTime: Date.now(),
              device: {
                platform: 'web',
                osVersion: 'unknown',
                screen: { width: 0, height: 0, pixelRatio: 1 },
              },
              app: { name: 'unknown', version: '0.0.0', identifier: 'unknown' },
              schemaVersion: SCHEMA_VERSION,
            },
            events: [],
            elements: [],
            screenshots: [],
            rrwebEvents: [],
          } as unknown as GremlinSession;
        }

        if (events && Array.isArray(events)) {
          session.events = [...(session.events || []), ...(events as GremlinEvent[])];
        }
        if (rrwebEvents && Array.isArray(rrwebEvents)) {
          session.rrwebEvents = [...(session.rrwebEvents || []), ...rrwebEvents];
        }

        const tempFile = `${sessionFile}.tmp`;
        writeFileSync(tempFile, JSON.stringify(session, null, 2));
        renameSync(tempFile, sessionFile);

        if (ctx.verbose && !ctx.jsonMode) {
          console.log(`  [append] ${sessionId}: +${events?.length || 0} events, +${rrwebEvents?.length || 0} rrweb`);
        }
      });

      return c.json({ status: 'ok', sessionId });
    } catch (err) {
      if (!ctx.jsonMode) console.error('  Error appending to session:', err);
      return c.json({ error: 'Failed to append to session' }, 500);
    }
  });

  // Legacy /sessions list — deprecated
  app.get('/sessions', async (c) => {
    console.warn('Deprecation: Use /v1/* endpoints instead of legacy /session* routes');
    const url = new URL(c.req.url);
    url.pathname = '/v1/sessions';
    const forwarded = new Request(url.toString(), {
      method: 'GET',
      headers: c.req.raw.headers,
    });
    return app.fetch(forwarded);
  });

  // -------------------------------------------------------------------------
  // Shared v1 API routes (single source of truth from @gremlin/server-shared)
  // -------------------------------------------------------------------------

  const storage = createDevStorageAdapter(ctx);
  registerApiRoutes(app, () => storage, { allowUnauthenticated: true });

  return app;
}

// ---------------------------------------------------------------------------
// Main dev() orchestrator
// ---------------------------------------------------------------------------

export async function dev(options: DevOptions): Promise<void> {
  const port = options.port ?? 3334;
  const sessionsDir = options.output ?? '.gremlin/sessions';
  const analyticsDir = '.gremlin/analytics';
  const verbose = options.verbose ?? false;
  const jsonMode = options.json ?? false;

  // Ensure directories exist
  ensureDir(sessionsDir);
  ensureDir(analyticsDir);

  const localIP = getLocalIP();
  const knownSessionIds = initKnownSessions(sessionsDir);

  // Build shared context for route handlers
  const ctx: DevContext = {
    sessionsDir,
    analyticsDir,
    verbose,
    jsonMode,
    knownSessionIds,
    sessionCount: knownSessionIds.size,
    withSessionLock: createSessionLock(),
  };

  // Startup output
  if (jsonMode) {
    outputNdjson({
      event: 'server_started',
      port,
      url: `http://localhost:${port}`,
      networkUrl: localIP ? `http://${localIP}:${port}` : null,
      sessionsDir,
    });
  } else {
    logServerBanner(port, sessionsDir, localIP);
  }

  cleanStaleTempFiles(sessionsDir);

  // Build Hono app and start HTTP server
  const app = createDevApp(ctx);

  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });

  if (!jsonMode) {
    console.log('  Press Ctrl+C to stop the server');
    console.log('');
  }

  // Graceful shutdown on signals
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (!jsonMode) console.log('\n  Shutting down...');
      server.stop();
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function getLocalIP(): string | null {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal and non-IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function extractAnalytics(session: GremlinSession): SessionAnalytics {
  const events = session.events || [];
  const duration =
    events.length > 0
      ? events.reduce((sum, e) => sum + (e.dt || 0), 0)
      : 0;

  const screens = new Set<string>();
  let errorCount = 0;

  for (const event of events) {
    if (event.data?.kind === 'navigation' && event.data?.screen) {
      screens.add(event.data.screen as string);
    }
    if (event.data?.kind === 'error') {
      errorCount++;
    }
  }

  return {
    sessionId: session.header.sessionId,
    duration,
    eventCount: events.length,
    errorCount,
    screens: Array.from(screens),
    platform: (session.header.device?.platform as 'web' | 'ios' | 'android') || 'web',
    appName: session.header.app?.name || 'unknown',
    deviceInfo: session.header.device || {},
    timestamp: new Date(session.header.startTime),
  };
}

function logSession(session: GremlinSession, count: number, verbose: boolean): void {
  const events = session.events || [];
  const rrwebEvents = session.rrwebEvents || [];
  const duration = events.length > 0 ? events.reduce((sum, e) => sum + (e.dt || 0), 0) / 1000 : 0;

  const app = session.header.app?.name || 'unknown';
  const platform = session.header.device?.platform || 'unknown';

  console.log(`  [${count}] Session received`);
  console.log(`      ID:       ${session.header.sessionId.slice(0, 8)}...`);
  console.log(`      App:      ${app} (${platform})`);
  console.log(`      Events:   ${events.length} events, ${rrwebEvents.length} rrweb`);
  console.log(`      Duration: ${duration.toFixed(1)}s`);
  console.log('');

  if (verbose && events.length > 0) {
    console.log('      Event breakdown:');
    const kinds = new Map<string, number>();
    for (const event of events) {
      const kind = event.data?.kind || 'unknown';
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
    }
    for (const [kind, cnt] of kinds.entries()) {
      console.log(`        - ${kind}: ${cnt}`);
    }
    console.log('');
  }
}

function logSessionSummary(outputDir: string): void {
  const metrics = getMetrics(outputDir);
  if (metrics.sessionCount === 0) {
    return;
  }

  console.log(`  Existing sessions: ${metrics.sessionCount}`);
  if (metrics.lastSession) {
    console.log(
      `  Last session: ${metrics.lastSession.appName} (${metrics.lastSession.platform}), ${metrics.lastSession.eventCount} events`
    );
  }
  console.log('');
}

function getMetrics(outputDir: string): {
  sessionCount: number;
  lastSession?: { appName: string; platform: string; eventCount: number };
} {
  try {
    const files = readdirSync(outputDir)
      .filter((file) => file.endsWith('.json'))
      .sort();

    if (files.length === 0) {
      return { sessionCount: 0 };
    }

    const lastFile = files[files.length - 1];
    const content = readFileSync(join(outputDir, lastFile), 'utf-8');
    const session = JSON.parse(content) as GremlinSession;
    return {
      sessionCount: files.length,
      lastSession: {
        appName: session.header?.app?.name || 'unknown',
        platform: session.header?.device?.platform || 'unknown',
        eventCount: session.events?.length || 0,
      },
    };
  } catch {
    return { sessionCount: 0 };
  }
}
