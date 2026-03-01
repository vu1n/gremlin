/**
 * Mobile Replay HTML Template
 *
 * Generates the HTML page for mobile gesture-based session replay.
 * Renders a phone mockup with tap/swipe animations and an event timeline.
 */

/**
 * Build the HTML page for mobile gesture session replay.
 */
export function buildMobileReplayHtml(session: any, speed: number): string {
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
    const session = ${JSON.stringify(session).replace(/<\//g, '<\\/')};
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

    // HTML escape function to prevent XSS
    function escapeHtml(unsafe) {
      if (unsafe === undefined || unsafe === null) return '';
      const str = String(unsafe);
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function renderEventList() {
      const list = document.getElementById('eventList');
      list.innerHTML = events.map((e, i) => {
        const icon = getEventIcon(e);
        const desc = escapeHtml(getEventDesc(e));
        const time = escapeHtml(formatTime(eventTimes[i]));
        return '<div class="event-item" id="event-' + i + '">' +
          '<span class="event-icon">' + escapeHtml(icon) + '</span>' +
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
      if (kind === 'tap') return 'Tap at (' + escapeHtml(e.data.x) + ', ' + escapeHtml(e.data.y) + ')';
      if (kind === 'swipe') return 'Swipe ' + escapeHtml(e.data.direction);
      if (kind === 'scroll') return 'Scroll';
      if (kind === 'input') return 'Input: ' + (e.data.masked ? '***' : escapeHtml(e.data.value?.slice(0,20)));
      if (kind === 'navigation') return 'Navigate to ' + escapeHtml(e.data.screen);
      if (kind === 'app_state') return 'App ' + escapeHtml(e.data.state);
      return escapeHtml(kind) || 'Event';
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
