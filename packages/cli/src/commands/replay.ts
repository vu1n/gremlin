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
import type { GremlinSession } from '@gremlin/session';

export interface ReplayOptions {
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
      console.error('No sessions found in .gremlin/sessions/');
      console.error('Run your app with the SDK to record sessions first.');
      process.exit(1);
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
    console.error(`Failed to load session: ${sessionPath}`);
    console.error(err);
    process.exit(1);
  }

  // Check if we have rrweb events
  const rrwebEvents = sessionData.rrwebEvents || sessionData.events?.filter?.((e: any) => e.type !== undefined);

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
  const html = generateReplayHtml(rrwebEvents, { autoPlay, speed });

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

/**
 * Generate HTML page with rrweb-player embedded
 */
function generateReplayHtml(
  events: any[],
  options: { autoPlay: boolean; speed: number }
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gremlin Session Replay</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.13/dist/style.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 20px;
      color: #4CAF50;
    }
    #player-container {
      background: #000;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .info {
      margin-top: 20px;
      font-size: 14px;
      color: #888;
    }
    .info code {
      background: #333;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <h1>🐸 Gremlin Session Replay</h1>
  <div id="player-container"></div>
  <p class="info">
    Events: <code>${events.length}</code> |
    Speed: <code>${options.speed}x</code> |
    <code>Space</code> to play/pause
  </p>

  <script src="https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.13/dist/index.js"></script>
  <script>
    const events = ${JSON.stringify(events)};

    const player = new rrwebPlayer({
      target: document.getElementById('player-container'),
      props: {
        events,
        autoPlay: ${options.autoPlay},
        speed: ${options.speed},
        showController: true,
        mouseTail: true,
        width: 1024,
        height: 768,
      },
    });

    // Keyboard shortcut for play/pause
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        player.toggle();
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Show text-based replay for sessions without rrweb events
 */
async function showTextReplay(session: any): Promise<void> {
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

  let lastTime = 0;
  for (const event of events) {
    const time = (event.dt || 0) / 1000;
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

/**
 * Find the most recent session in .gremlin/sessions/
 */
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
