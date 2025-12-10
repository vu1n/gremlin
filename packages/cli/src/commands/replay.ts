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
 * Show mobile gesture replay with phone mockup
 */
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

  const html = generateMobileReplayHtml(session, speed);

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

/**
 * Generate HTML for mobile gesture replay
 */
function generateMobileReplayHtml(session: any, speed: number): string {
  const device = session.header?.device || {};
  const app = session.header?.app || {};
  const events = session.events || [];

  // Phone dimensions (scale to fit)
  const phoneWidth = device.screen?.width || 390;
  const phoneHeight = device.screen?.height || 844;
  const scale = Math.min(400 / phoneWidth, 700 / phoneHeight);
  const scaledWidth = Math.round(phoneWidth * scale);
  const scaledHeight = Math.round(phoneHeight * scale);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gremlin Mobile Replay - ${app.name || 'Session'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #eee;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    h1 { font-size: 20px; margin-bottom: 15px; color: #4CAF50; }
    .container { display: flex; gap: 30px; align-items: flex-start; }

    /* Phone mockup */
    .phone-frame {
      background: #1c1c1e;
      border-radius: 40px;
      padding: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5), inset 0 0 0 3px #333;
    }
    .phone-screen {
      width: ${scaledWidth}px;
      height: ${scaledHeight}px;
      background: #f5f5f7;
      border-radius: 30px;
      position: relative;
      overflow: hidden;
    }
    .notch {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 120px;
      height: 30px;
      background: #1c1c1e;
      border-radius: 0 0 20px 20px;
      z-index: 10;
    }

    /* Gesture indicators */
    .tap-indicator {
      position: absolute;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: rgba(76, 175, 80, 0.6);
      border: 3px solid #4CAF50;
      transform: translate(-50%, -50%) scale(0);
      pointer-events: none;
      z-index: 100;
    }
    .tap-indicator.active {
      animation: tap-pulse 0.4s ease-out forwards;
    }
    @keyframes tap-pulse {
      0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
      50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.8; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
    }

    .swipe-line {
      position: absolute;
      height: 4px;
      background: linear-gradient(90deg, #2196F3, #03A9F4);
      border-radius: 2px;
      transform-origin: left center;
      pointer-events: none;
      z-index: 100;
      opacity: 0;
    }
    .swipe-line.active {
      animation: swipe-draw 0.5s ease-out forwards;
    }
    @keyframes swipe-draw {
      0% { opacity: 0; }
      20% { opacity: 1; }
      100% { opacity: 0; }
    }

    .swipe-arrow {
      position: absolute;
      width: 0;
      height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 12px solid #03A9F4;
      pointer-events: none;
      z-index: 101;
      opacity: 0;
    }
    .swipe-arrow.active {
      animation: arrow-show 0.5s ease-out forwards;
    }
    @keyframes arrow-show {
      0% { opacity: 0; }
      20% { opacity: 1; }
      100% { opacity: 0; }
    }

    /* Timeline & controls */
    .sidebar {
      width: 320px;
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 15px;
    }
    .controls {
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .btn-play {
      background: #4CAF50;
      color: white;
      flex: 1;
    }
    .btn-play:hover { background: #45a049; }
    .btn-play.playing { background: #ff9800; }
    .btn-reset {
      background: #444;
      color: white;
    }
    .btn-reset:hover { background: #555; }

    .progress-bar {
      height: 6px;
      background: #333;
      border-radius: 3px;
      margin-bottom: 15px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #8BC34A);
      width: 0%;
      transition: width 0.1s linear;
    }

    .time-display {
      text-align: center;
      font-family: monospace;
      font-size: 18px;
      margin-bottom: 15px;
      color: #aaa;
    }

    .event-list {
      max-height: 400px;
      overflow-y: auto;
      font-size: 12px;
    }
    .event-item {
      padding: 8px 10px;
      border-radius: 6px;
      margin-bottom: 4px;
      background: rgba(255,255,255,0.05);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .event-item.active {
      background: rgba(76, 175, 80, 0.2);
      border-left: 3px solid #4CAF50;
    }
    .event-item.played {
      opacity: 0.5;
    }
    .event-icon {
      font-size: 16px;
    }
    .event-time {
      font-family: monospace;
      color: #888;
      font-size: 11px;
    }
    .event-desc {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .info-bar {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #333;
      font-size: 11px;
      color: #666;
    }
    .info-bar div { margin-bottom: 4px; }
    .info-bar span { color: #888; }
  </style>
</head>
<body>
  <h1>🐸 Gremlin Mobile Replay</h1>

  <div class="container">
    <div class="phone-frame">
      <div class="phone-screen" id="screen">
        <div class="notch"></div>
        <div class="tap-indicator" id="tap"></div>
        <div class="swipe-line" id="swipe"></div>
        <div class="swipe-arrow" id="arrow"></div>
      </div>
    </div>

    <div class="sidebar">
      <div class="controls">
        <button class="btn-play" id="playBtn" onclick="togglePlay()">▶ Play</button>
        <button class="btn-reset" onclick="resetReplay()">↺ Reset</button>
      </div>

      <div class="progress-bar">
        <div class="progress-fill" id="progress"></div>
      </div>

      <div class="time-display">
        <span id="currentTime">0:00.0</span> / <span id="totalTime">0:00.0</span>
      </div>

      <div class="event-list" id="eventList"></div>

      <div class="info-bar">
        <div><span>App:</span> ${app.name || 'Unknown'} v${app.version || '?'}</div>
        <div><span>Device:</span> ${device.platform || '?'} ${device.osVersion || ''}</div>
        <div><span>Screen:</span> ${phoneWidth}×${phoneHeight}</div>
      </div>
    </div>
  </div>

  <script>
    const session = ${JSON.stringify(session)};
    const events = session.events || [];
    const scale = ${scale};
    const speed = ${speed};

    let isPlaying = false;
    let currentIndex = 0;
    let currentTime = 0;
    let totalDuration = 0;
    let playTimeout = null;

    // Calculate cumulative times
    const eventTimes = [];
    let cumTime = 0;
    for (const event of events) {
      eventTimes.push(cumTime);
      cumTime += (event.dt || 0);
    }
    totalDuration = cumTime;

    // Initialize UI
    function init() {
      document.getElementById('totalTime').textContent = formatTime(totalDuration);
      renderEventList();
    }

    function formatTime(ms) {
      const secs = ms / 1000;
      const mins = Math.floor(secs / 60);
      const s = (secs % 60).toFixed(1);
      return mins > 0 ? mins + ':' + s.padStart(4, '0') : '0:' + s.padStart(4, '0');
    }

    function renderEventList() {
      const list = document.getElementById('eventList');
      list.innerHTML = events.map((e, i) => {
        const icon = getEventIcon(e);
        const desc = getEventDesc(e);
        const time = formatTime(eventTimes[i]);
        return '<div class="event-item" id="event-' + i + '">' +
          '<span class="event-icon">' + icon + '</span>' +
          '<span class="event-time">' + time + '</span>' +
          '<span class="event-desc">' + desc + '</span></div>';
      }).join('');
    }

    function getEventIcon(e) {
      const kind = e.data?.kind;
      if (kind === 'tap') return '👆';
      if (kind === 'double_tap') return '👆👆';
      if (kind === 'long_press') return '✋';
      if (kind === 'swipe') {
        const dir = e.data?.direction;
        if (dir === 'up') return '⬆️';
        if (dir === 'down') return '⬇️';
        if (dir === 'left') return '⬅️';
        if (dir === 'right') return '➡️';
        return '↔️';
      }
      if (kind === 'scroll') return '📜';
      if (kind === 'input') return '⌨️';
      if (kind === 'navigation') return '🧭';
      if (kind === 'app_state') return '📱';
      return '•';
    }

    function getEventDesc(e) {
      const kind = e.data?.kind;
      if (kind === 'tap') return 'Tap at (' + e.data.x + ', ' + e.data.y + ')';
      if (kind === 'swipe') return 'Swipe ' + e.data.direction;
      if (kind === 'scroll') return 'Scroll';
      if (kind === 'input') return 'Input: ' + (e.data.masked ? '***' : e.data.value?.slice(0,20));
      if (kind === 'navigation') return 'Navigate to ' + e.data.screen;
      if (kind === 'app_state') return 'App ' + e.data.state;
      return kind || 'Event';
    }

    function togglePlay() {
      if (isPlaying) {
        pause();
      } else {
        play();
      }
    }

    function play() {
      isPlaying = true;
      document.getElementById('playBtn').textContent = '⏸ Pause';
      document.getElementById('playBtn').classList.add('playing');
      playNext();
    }

    function pause() {
      isPlaying = false;
      document.getElementById('playBtn').textContent = '▶ Play';
      document.getElementById('playBtn').classList.remove('playing');
      if (playTimeout) {
        clearTimeout(playTimeout);
        playTimeout = null;
      }
    }

    function playNext() {
      if (!isPlaying || currentIndex >= events.length) {
        if (currentIndex >= events.length) {
          pause();
          currentIndex = events.length;
        }
        return;
      }

      const event = events[currentIndex];
      const eventTime = eventTimes[currentIndex];

      // Update time display
      currentTime = eventTime;
      document.getElementById('currentTime').textContent = formatTime(currentTime);
      document.getElementById('progress').style.width = (currentTime / totalDuration * 100) + '%';

      // Update event list highlighting
      document.querySelectorAll('.event-item').forEach((el, i) => {
        el.classList.remove('active');
        if (i < currentIndex) el.classList.add('played');
        else el.classList.remove('played');
      });
      const currentEl = document.getElementById('event-' + currentIndex);
      if (currentEl) {
        currentEl.classList.add('active');
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Show gesture
      showGesture(event);

      currentIndex++;

      // Schedule next event
      const nextDelay = currentIndex < events.length ? (events[currentIndex].dt || 500) / speed : 0;
      playTimeout = setTimeout(playNext, Math.max(nextDelay, 100));
    }

    function showGesture(event) {
      const screen = document.getElementById('screen');
      const tap = document.getElementById('tap');
      const swipe = document.getElementById('swipe');
      const arrow = document.getElementById('arrow');

      const kind = event.data?.kind;

      if (kind === 'tap' || kind === 'double_tap' || kind === 'long_press') {
        const x = event.data.x * scale;
        const y = event.data.y * scale;

        tap.style.left = x + 'px';
        tap.style.top = y + 'px';
        tap.classList.remove('active');
        void tap.offsetWidth; // Trigger reflow
        tap.classList.add('active');
      }

      if (kind === 'swipe') {
        const startX = event.data.startX * scale;
        const startY = event.data.startY * scale;
        const endX = event.data.endX * scale;
        const endY = event.data.endY * scale;

        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.sqrt(dx*dx + dy*dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        swipe.style.left = startX + 'px';
        swipe.style.top = startY + 'px';
        swipe.style.width = length + 'px';
        swipe.style.transform = 'rotate(' + angle + 'deg)';
        swipe.classList.remove('active');
        void swipe.offsetWidth;
        swipe.classList.add('active');

        // Arrow at end
        arrow.style.left = endX + 'px';
        arrow.style.top = endY + 'px';
        arrow.style.transform = 'translate(-50%, -50%) rotate(' + (angle + 90) + 'deg)';
        arrow.classList.remove('active');
        void arrow.offsetWidth;
        arrow.classList.add('active');
      }
    }

    function resetReplay() {
      pause();
      currentIndex = 0;
      currentTime = 0;
      document.getElementById('currentTime').textContent = formatTime(0);
      document.getElementById('progress').style.width = '0%';
      document.querySelectorAll('.event-item').forEach(el => {
        el.classList.remove('active', 'played');
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === 'KeyR') {
        resetReplay();
      }
    });

    init();
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
