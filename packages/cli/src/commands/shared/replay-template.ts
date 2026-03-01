/**
 * Replay HTML Template
 *
 * Generates the HTML page for rrweb-based session replay.
 * Used by the replay command to serve a browser-based player.
 */

interface ReplayHtmlOptions {
  autoPlay: boolean;
  speed: number;
}

/**
 * Build the HTML page for rrweb desktop session replay.
 */
export function buildReplayHtml(
  events: any[],
  options: ReplayHtmlOptions,
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
    const events = ${JSON.stringify(events).replace(/<\//g, '<\\/')};

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
