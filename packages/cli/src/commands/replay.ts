/**
 * Replay Command
 *
 * Replays a recorded session in a browser.
 * Opens a local server with rrweb-player or Playwright-based replay.
 *
 * Supports:
 *   gremlin replay <path>    - replay specific session
 *   gremlin replay latest    - replay most recent session
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildReplayHtml } from './shared/replay-template.ts';
import { buildMobileReplayHtml } from './shared/mobile-replay-template.ts';

interface ReplayOptions {
  /** Path to session file or "latest" */
  session: string;

  /** Port for replay server */
  port?: number;

  /** Auto-play on load */
  autoPlay?: boolean;

  /** Playback speed */
  speed?: number;
}

/**
 * Replay a recorded session.
 *
 * For sessions with rrweb events: Opens a browser with rrweb-player
 * For sessions without rrweb: Shows a summary of events
 */
export async function replay(options: ReplayOptions): Promise<void> {
  let sessionPath = options.session;

  // Handle "latest" keyword
  if (sessionPath === 'latest') {
    const latestPath = await findLatestSession();
    if (!latestPath) {
      throw new Error('No sessions found in .gremlin/sessions/. Run your app with the SDK to record sessions first.');
    }
    sessionPath = latestPath;
    console.log(`Latest session: ${sessionPath}`);
  }

  console.log('Loading session...');

  // Load session file
  let sessionData: any;
  try {
    const content = await readFile(sessionPath, 'utf-8');
    sessionData = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to load session: ${sessionPath}: ${err instanceof Error ? err.message : err}`);
  }

  // Check if this is a mobile session (has gesture events, not rrweb)
  const isMobileSession = sessionData.header?.device?.platform === 'ios' ||
                          sessionData.header?.device?.platform === 'android' ||
                          sessionData.events?.some((e: any) => e.data?.kind === 'tap' || e.data?.kind === 'swipe');

  if (isMobileSession) {
    // Use mobile gesture replay
    await showMobileReplay(sessionData, options);
    return;
  }

  // Check if we have rrweb events
  const rrwebEvents = sessionData.rrwebEvents || sessionData.events?.filter?.((e: any) => e.type !== undefined && !e.data?.kind);

  if (!rrwebEvents || rrwebEvents.length === 0) {
    // No rrweb events - show text summary instead
    await showTextReplay(sessionData);
    return;
  }

  // Start replay server
  const port = options.port ?? 3333;
  const autoPlay = options.autoPlay ?? true;
  const speed = options.speed ?? 1;

  console.log(`🎬 Starting replay server on http://localhost:${port}`);
  console.log(`   Events: ${rrwebEvents.length}`);
  console.log(`   Speed: ${speed}x`);
  console.log('');

  // Create HTML page with rrweb-player
  const html = buildReplayHtml(rrwebEvents, { autoPlay, speed });

  // Start a simple HTTP server
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/') {
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      if (url.pathname === '/events.json') {
        return new Response(JSON.stringify(rrwebEvents), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`🌐 Open http://localhost:${port} in your browser to watch the replay`);
  console.log('   Press Ctrl+C to stop the server');

  // Keep server running
  await new Promise(() => {});
}

async function showMobileReplay(session: any, options: ReplayOptions): Promise<void> {
  const port = options.port ?? 3333;
  const speed = options.speed ?? 1;

  const device = session.header?.device || {};
  const app = session.header?.app || {};
  const events = session.events || [];

  // Calculate total duration from events
  let totalDuration = 0;
  for (const event of events) {
    totalDuration += event.dt || 0;
  }

  console.log(`🎬 Starting mobile replay server on http://localhost:${port}`);
  console.log(`   App: ${app.name} (${device.platform})`);
  console.log(`   Events: ${events.length}`);
  console.log(`   Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('');

  const html = buildMobileReplayHtml(session, speed);

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/') {
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url.pathname === '/session.json') {
        return new Response(JSON.stringify(session), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`🌐 Open http://localhost:${port} in your browser to watch the replay`);
  console.log('   Press Ctrl+C to stop the server');

  await new Promise(() => {});
}

function showTextReplay(session: any): void {
  console.log('');
  console.log('📝 Session Summary (no DOM replay available)');
  console.log('═'.repeat(50));
  console.log('');

  if (session.header) {
    console.log(`Session ID: ${session.header.sessionId}`);
    console.log(`App: ${session.header.app?.name} v${session.header.app?.version}`);
    console.log(`Platform: ${session.header.device?.platform}`);
    console.log(`Started: ${new Date(session.header.startTime).toISOString()}`);
    console.log('');
  }

  const events = session.events || [];
  const elements = session.elements || [];

  console.log(`Events: ${events.length}`);
  console.log(`Elements: ${elements.length}`);
  console.log('');
  console.log('Event Timeline:');
  console.log('─'.repeat(50));

  let elapsed = 0;
  let lastTime = 0;
  for (const event of events) {
    elapsed += (event.dt || 0);
    const time = elapsed / 1000;
    const timeDiff = time - lastTime;
    lastTime = time;

    const data = event.data || {};
    let description = '';

    switch (data.kind) {
      case 'tap':
      case 'double_tap':
      case 'long_press': {
        const el = data.elementIndex !== undefined ? elements[data.elementIndex] : null;
        const target = el?.testId || el?.text?.slice(0, 20) || `(${data.x}, ${data.y})`;
        description = `${data.kind.toUpperCase()} on ${target}`;
        break;
      }
      case 'input': {
        const el = data.elementIndex !== undefined ? elements[data.elementIndex] : null;
        const target = el?.testId || el?.text?.slice(0, 20) || 'input';
        const value = data.masked ? '***' : `"${data.value?.slice(0, 20)}"`;
        description = `INPUT ${target} = ${value}`;
        break;
      }
      case 'navigation':
        description = `NAVIGATE to "${data.screen}" (${data.navType})`;
        break;
      case 'scroll':
        description = `SCROLL to (${data.scrollX}, ${data.scrollY})`;
        break;
      case 'network':
        description = `NETWORK ${data.method} ${data.url?.slice(0, 40)}`;
        break;
      case 'error':
        description = `ERROR: ${data.message?.slice(0, 40)}`;
        break;
      default:
        description = `${data.kind || 'unknown'}: ${JSON.stringify(data).slice(0, 50)}`;
    }

    // Format time
    const mins = Math.floor(time / 60);
    const secs = (time % 60).toFixed(1);
    const timeStr = mins > 0 ? `${mins}:${secs.padStart(4, '0')}` : `${secs}s`;

    // Format with delay indicator
    const delayStr = timeDiff > 2 ? ` (+${timeDiff.toFixed(1)}s)` : '';

    console.log(`  ${timeStr}${delayStr.padEnd(10)} ${description}`);
  }

  console.log('');
  console.log('─'.repeat(50));
  console.log('');
  console.log('Tip: Record sessions with the SDK for full DOM replay');
}

async function findLatestSession(): Promise<string | null> {
  const sessionsDir = '.gremlin/sessions';

  if (!existsSync(sessionsDir)) {
    return null;
  }

  try {
    const files = await readdir(sessionsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      return null;
    }

    // Get file stats and sort by modification time
    const filesWithStats = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = join(sessionsDir, file);
        const stats = await stat(filePath);
        return { file, mtime: stats.mtime.getTime() };
      })
    );

    // Sort by modification time (most recent first)
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    return join(sessionsDir, filesWithStats[0].file);
  } catch {
    return null;
  }
}
