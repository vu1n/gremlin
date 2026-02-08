/**
 * Dev Command
 *
 * Starts a local development server that receives session recordings
 * from the SDK. This is the zero-config local development workflow.
 *
 * Usage:
 *   gremlin dev              # Starts server on :3334
 *   gremlin dev --port 4000  # Custom port
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
} from 'fs';
import { join } from 'path';
import { networkInterfaces } from 'os';
import type { GremlinSession, SessionAnalytics } from '@gremlin/session';
import { outputNdjson, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface DevOptions extends OutputOptions {
  /** Port for dev server */
  port?: number;

  /** Output directory for sessions */
  output?: string;

  /** Verbose logging */
  verbose?: boolean;
}

// ============================================================================
// Main Command
// ============================================================================

export async function dev(options: DevOptions): Promise<void> {
  const port = options.port ?? 3334;
  const output = options.output ?? '.gremlin/sessions';
  const analyticsDir = '.gremlin/analytics';
  const verbose = options.verbose ?? false;
  const jsonMode = options.json ?? false;

  // Ensure directories exist
  ensureDir(output);
  ensureDir(analyticsDir);

  const localIP = getLocalIP();

  if (jsonMode) {
    outputNdjson({
      event: 'server_started',
      port,
      url: `http://localhost:${port}`,
      networkUrl: localIP ? `http://${localIP}:${port}` : null,
      sessionsDir: output,
    });
  } else {
    console.log('');
    console.log('  Gremlin Dev Server');
    console.log('  ==================');
    console.log('');
    console.log(`  Status:     Running`);
    console.log(`  Port:       ${port}`);
    console.log(`  Sessions:   ${output}/`);
    console.log('');
    console.log('  Endpoints:');
    console.log(`    Local:    http://localhost:${port}`);
    if (localIP) {
      console.log(`    Network:  http://${localIP}:${port}  (for React Native)`);
    }
    console.log('');
    logSessionSummary(output);
    console.log('  Waiting for sessions...');
    console.log('  ' + '─'.repeat(40));
    console.log('');
  }

  // Initialize from existing session files on disk
  const existingFiles = existsSync(output)
    ? readdirSync(output).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    : [];
  const knownSessionIds = new Set<string>(
    existingFiles.map((f) => f.replace('.json', ''))
  );
  let sessionCount = knownSessionIds.size;

  // Per-session lock to prevent read-modify-write races on concurrent appends
  const sessionLocks = new Map<string, Promise<unknown>>();
  function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
    const result = prev.catch(() => {}).then(async () => {
      try {
        return await fn();
      } finally {
        // Clean up lock entry after this chain resolves
        if (sessionLocks.get(sessionId) === result) {
          sessionLocks.delete(sessionId);
        }
      }
    });
    sessionLocks.set(sessionId, result);
    return result;
  }

  // Start HTTP server
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers for SDK
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Health check
      if (url.pathname === '/' || url.pathname === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            server: 'gremlin-dev',
            version: '0.0.1',
            sessions: sessionCount,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (url.pathname === '/metrics') {
        const metrics = getMetrics(output);
        return new Response(
          JSON.stringify({
            status: 'ok',
            ...metrics,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Receive session
      if (url.pathname === '/session' && req.method === 'POST') {
        try {
          const body = await req.json();
          const session = body as GremlinSession;

          // Validate session has required fields
          if (!session.header?.sessionId) {
            return new Response(
              JSON.stringify({ error: 'Invalid session: missing sessionId' }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              }
            );
          }

          if (!knownSessionIds.has(session.header.sessionId)) {
            knownSessionIds.add(session.header.sessionId);
            sessionCount++;
          }

          // Save session (atomic write)
          const sessionFile = join(output, `${session.header.sessionId}.json`);
          const tempFile = `${sessionFile}.tmp`;
          writeFileSync(tempFile, JSON.stringify(session, null, 2));
          renameSync(tempFile, sessionFile);

          // Log analytics (atomic write)
          const analytics = extractAnalytics(session);
          const analyticsFile = join(analyticsDir, `${session.header.sessionId}.json`);
          const analyticsTemp = `${analyticsFile}.tmp`;
          writeFileSync(analyticsTemp, JSON.stringify(analytics, null, 2));
          renameSync(analyticsTemp, analyticsFile);

          // Log to console
          if (jsonMode) {
            outputNdjson({
              event: 'session_received',
              sessionId: session.header.sessionId,
              app: session.header.app?.name || 'unknown',
              platform: session.header.device?.platform || 'unknown',
              eventCount: session.events?.length || 0,
              rrwebEventCount: session.rrwebEvents?.length || 0,
              savedTo: sessionFile,
            });
          } else {
            logSession(session, sessionCount, verbose);
          }

          return new Response(
            JSON.stringify({
              status: 'ok',
              sessionId: session.header.sessionId,
              saved: sessionFile,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        } catch (err) {
          if (!jsonMode) console.error('  Error processing session:', err);
          return new Response(
            JSON.stringify({ error: 'Failed to process session' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      // Session append (for streaming/incremental uploads)
      if (url.pathname === '/session/append' && req.method === 'POST') {
        try {
          const body = await req.json();
          const { sessionId, events, rrwebEvents } = body;

          if (!sessionId) {
            return new Response(
              JSON.stringify({ error: 'Missing sessionId' }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              }
            );
          }

          const sessionFile = join(output, `${sessionId}.json`);

          // Track session for count
          if (!knownSessionIds.has(sessionId)) {
            knownSessionIds.add(sessionId);
            sessionCount++;
          }

          // Lock per session to prevent concurrent read-modify-write races
          await withSessionLock(sessionId, async () => {
            // Load existing session or create new one
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
                  schemaVersion: 1,
                },
                events: [],
                elements: [],
                screenshots: [],
                rrwebEvents: [],
              } as unknown as GremlinSession;
            }

            // Append events
            if (events && Array.isArray(events)) {
              session.events = [...(session.events || []), ...events];
            }
            if (rrwebEvents && Array.isArray(rrwebEvents)) {
              session.rrwebEvents = [...(session.rrwebEvents || []), ...rrwebEvents];
            }

            // Save updated session (atomic write)
            const tempFile = `${sessionFile}.tmp`;
            writeFileSync(tempFile, JSON.stringify(session, null, 2));
            renameSync(tempFile, sessionFile);

            if (verbose && !jsonMode) {
              console.log(`  [append] ${sessionId}: +${events?.length || 0} events, +${rrwebEvents?.length || 0} rrweb`);
            }
          });

          return new Response(
            JSON.stringify({ status: 'ok', sessionId }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        } catch (err) {
          if (!jsonMode) console.error('  Error appending to session:', err);
          return new Response(
            JSON.stringify({ error: 'Failed to append to session' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      // List sessions
      if (url.pathname === '/sessions' && req.method === 'GET') {
        try {
          const limit = parseInt(url.searchParams.get('limit') || '50', 10);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);

          const files = await import('fs').then((fs) =>
            fs.readdirSync(output).filter((f: string) => f.endsWith('.json'))
          );

          // Sort by filename (contains timestamp) desc, then paginate
          const sortedFiles = files.sort().reverse().slice(offset, offset + limit);

          const sessions = await Promise.all(
            sortedFiles.map(async (file: string) => {
              const content = await Bun.file(join(output, file)).text();
              const session = JSON.parse(content);
              return {
                sessionId: session.header?.sessionId,
                startTime: session.header?.startTime,
                eventCount: session.events?.length || 0,
                platform: session.header?.device?.platform,
              };
            })
          );

          return new Response(JSON.stringify({ sessions, total: files.length, limit, offset }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ sessions: [], total: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    },
  });

  if (!jsonMode) {
    console.log('  Press Ctrl+C to stop the server');
    console.log('');
  }

  // Keep server running
  await new Promise(() => {});
}

// ============================================================================
// Helpers
// ============================================================================

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

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
