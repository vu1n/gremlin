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

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { networkInterfaces } from 'os';
import type { GremlinSession, SessionAnalytics } from '@gremlin/session';

// ============================================================================
// Types
// ============================================================================

export interface DevOptions {
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

  // Ensure directories exist
  ensureDir(output);
  ensureDir(analyticsDir);

  console.log('');
  console.log('  Gremlin Dev Server');
  console.log('  ==================');
  console.log('');
  console.log(`  Status:     Running`);
  console.log(`  Port:       ${port}`);
  console.log(`  Sessions:   ${output}/`);
  console.log('');

  // Get local IP for RN connections
  const localIP = getLocalIP();
  console.log('  Endpoints:');
  console.log(`    Local:    http://localhost:${port}`);
  if (localIP) {
    console.log(`    Network:  http://${localIP}:${port}  (for React Native)`);
  }
  console.log('');
  console.log('  Waiting for sessions...');
  console.log('  ' + '─'.repeat(40));
  console.log('');

  let sessionCount = 0;

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

          sessionCount++;

          // Save session
          const sessionFile = join(output, `${session.header.sessionId}.json`);
          writeFileSync(sessionFile, JSON.stringify(session, null, 2));

          // Log analytics
          const analytics = extractAnalytics(session);
          const analyticsFile = join(analyticsDir, `${session.header.sessionId}.json`);
          writeFileSync(analyticsFile, JSON.stringify(analytics, null, 2));

          // Log to console
          logSession(session, sessionCount, verbose);

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
          console.error('  Error processing session:', err);
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

          // Load existing session or create new one
          let session: GremlinSession;
          if (existsSync(sessionFile)) {
            const content = await Bun.file(sessionFile).text();
            session = JSON.parse(content);
          } else {
            // Stub session for incremental batch uploads - full header comes from client
            session = {
              header: { sessionId, startTime: Date.now() },
              events: [],
              elements: [],
              screenshots: [],
            } as unknown as GremlinSession;
          }

          // Append events
          if (events && Array.isArray(events)) {
            session.events = [...(session.events || []), ...events];
          }
          if (rrwebEvents && Array.isArray(rrwebEvents)) {
            session.rrwebEvents = [...(session.rrwebEvents || []), ...rrwebEvents];
          }

          // Save updated session
          writeFileSync(sessionFile, JSON.stringify(session, null, 2));

          if (verbose) {
            console.log(`  [append] ${sessionId}: +${events?.length || 0} events, +${rrwebEvents?.length || 0} rrweb`);
          }

          return new Response(
            JSON.stringify({ status: 'ok', sessionId }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        } catch (err) {
          console.error('  Error appending to session:', err);
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
          const files = await import('fs').then((fs) =>
            fs.readdirSync(output).filter((f: string) => f.endsWith('.json'))
          );

          const sessions = await Promise.all(
            files.map(async (file: string) => {
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

          return new Response(JSON.stringify(sessions), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    },
  });

  console.log('  Press Ctrl+C to stop the server');
  console.log('');

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
      ? Math.max(...events.map((e) => e.dt || 0))
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
  const duration = events.length > 0 ? Math.max(...events.map((e) => e.dt || 0)) / 1000 : 0;

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
