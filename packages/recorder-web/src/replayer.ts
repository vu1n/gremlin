/**
 * GremlinReplayer - Session replay using rrweb-player
 *
 * Plays back recorded sessions with the rrweb DOM reconstruction.
 * Supports overlays for Gremlin events (taps, inputs, navigations).
 */

import type { eventWithTime } from 'rrweb';

// ============================================================================
// Types
// ============================================================================

export interface ReplayerConfig {
  /** Container element to mount the player */
  container: HTMLElement;

  /** Width of the replay viewport */
  width?: number;

  /** Height of the replay viewport */
  height?: number;

  /** Show controls (play/pause, timeline, speed) */
  showControls?: boolean;

  /** Auto-play on load */
  autoPlay?: boolean;

  /** Playback speed (1 = normal) */
  speed?: number;

  /** Skip inactive periods (speeds up gaps > threshold) */
  skipInactive?: boolean;

  /** Inactive threshold in ms (default 5000) */
  inactiveThreshold?: number;

  /** Show click indicators */
  showClicks?: boolean;

  /** Callback when replay reaches end */
  onEnd?: () => void;

  /** Callback on time update */
  onTimeUpdate?: (time: number, totalTime: number) => void;
}

export interface RrwebSession {
  /** rrweb events for DOM replay */
  events: eventWithTime[];

  /** Session metadata */
  metadata?: {
    sessionId?: string;
    duration?: number;
    startTime?: number;
    appName?: string;
    appVersion?: string;
  };
}

// ============================================================================
// Replayer
// ============================================================================

/**
 * Session replayer using rrweb-player.
 *
 * Note: rrweb-player is a heavy dependency and loads CSS.
 * For CLI replay, use a different approach (headless browser).
 */
export class GremlinReplayer {
  private config: Required<ReplayerConfig>;
  private player: any = null;
  private session: RrwebSession | null = null;
  private isPlaying = false;

  constructor(config: ReplayerConfig) {
    this.config = {
      container: config.container,
      width: config.width ?? 1024,
      height: config.height ?? 768,
      showControls: config.showControls ?? true,
      autoPlay: config.autoPlay ?? false,
      speed: config.speed ?? 1,
      skipInactive: config.skipInactive ?? true,
      inactiveThreshold: config.inactiveThreshold ?? 5000,
      showClicks: config.showClicks ?? true,
      onEnd: config.onEnd ?? (() => {}),
      onTimeUpdate: config.onTimeUpdate ?? (() => {}),
    };
  }

  /**
   * Load a session for replay.
   */
  async load(session: RrwebSession): Promise<void> {
    if (!session.events || session.events.length === 0) {
      throw new Error('No rrweb events to replay');
    }

    this.session = session;

    // Dynamically import rrweb-player to avoid loading it until needed
    const { default: rrwebPlayer } = await import('rrweb-player');

    // Import CSS - in a bundler context this would be handled differently
    // For now, inject it dynamically
    this.injectPlayerStyles();

    // Clear container
    this.config.container.innerHTML = '';

    // Create player
    this.player = new rrwebPlayer({
      target: this.config.container,
      props: {
        events: session.events,
        width: this.config.width,
        height: this.config.height,
        autoPlay: this.config.autoPlay,
        speed: this.config.speed,
        skipInactive: this.config.skipInactive,
        showController: this.config.showControls,
        mouseTail: this.config.showClicks,
      },
    });

    // Set up event listeners
    this.setupEventListeners();

    if (this.config.autoPlay) {
      this.isPlaying = true;
    }
  }

  /**
   * Start or resume playback.
   */
  play(): void {
    if (!this.player) {
      console.warn('GremlinReplayer: No session loaded');
      return;
    }

    this.player.play();
    this.isPlaying = true;
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (!this.player) return;

    this.player.pause();
    this.isPlaying = false;
  }

  /**
   * Toggle play/pause.
   */
  toggle(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Seek to a specific time (ms).
   */
  goto(timeMs: number): void {
    if (!this.player) return;

    this.player.goto(timeMs);
  }

  /**
   * Set playback speed.
   */
  setSpeed(speed: number): void {
    if (!this.player) return;

    this.player.setSpeed(speed);
  }

  /**
   * Get current playback time (ms).
   */
  getCurrentTime(): number {
    if (!this.player) return 0;

    return this.player.getCurrentTime();
  }

  /**
   * Get total duration (ms).
   */
  getDuration(): number {
    if (!this.session?.events || this.session.events.length === 0) return 0;

    const first = this.session.events[0].timestamp;
    const last = this.session.events[this.session.events.length - 1].timestamp;
    return last - first;
  }

  /**
   * Check if currently playing.
   */
  isActive(): boolean {
    return this.isPlaying;
  }

  /**
   * Destroy the player and clean up.
   */
  destroy(): void {
    if (this.player) {
      this.player.$destroy();
      this.player = null;
    }
    this.session = null;
    this.isPlaying = false;
    this.config.container.innerHTML = '';
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private setupEventListeners(): void {
    if (!this.player) return;

    // rrweb-player emits events via Svelte custom events
    // Access the underlying replayer for more control
    const replayer = this.player.getReplayer?.();

    if (replayer) {
      replayer.on('finish', () => {
        this.isPlaying = false;
        this.config.onEnd();
      });
    }

    // Poll for time updates (rrweb-player doesn't have a native time event)
    const pollInterval = setInterval(() => {
      if (!this.player || !this.isPlaying) return;

      const current = this.getCurrentTime();
      const total = this.getDuration();
      this.config.onTimeUpdate(current, total);

      // Stop polling when finished
      if (current >= total) {
        clearInterval(pollInterval);
      }
    }, 100);
  }

  private injectPlayerStyles(): void {
    // Check if styles already injected
    if (document.getElementById('gremlin-rrweb-player-styles')) return;

    // rrweb-player requires its CSS - inject minimal styles
    const style = document.createElement('style');
    style.id = 'gremlin-rrweb-player-styles';
    style.textContent = `
      .rr-player {
        position: relative;
        background: #000;
      }
      .rr-player__frame {
        overflow: hidden;
      }
      .replayer-wrapper {
        position: relative;
      }
      .replayer-mouse {
        position: absolute;
        width: 20px;
        height: 20px;
        transition: left 0.05s linear, top 0.05s linear;
        background-size: contain;
        background-position: center center;
        background-repeat: no-repeat;
        background-image: url("data:image/svg+xml,%3Csvg height='16' width='16' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0l5 14 3-4 6 5 2-2-5-6 4-3z' fill='%23000'/%3E%3Cpath d='M1.5 2l3.5 10 2.5-3.5 5 4 .5-.5-4-5 3.5-2.5z' fill='%23fff'/%3E%3C/svg%3E");
      }
      .replayer-mouse::after {
        content: '';
        display: inline-block;
        width: 20px;
        height: 20px;
        border-radius: 10px;
        background: #ff4444;
        transform: translate(-50%, -50%);
        opacity: 0.3;
      }
      .replayer-mouse.active::after {
        animation: click 0.2s ease-in-out 1;
      }
      @keyframes click {
        0% { opacity: 0.3; width: 20px; height: 20px; }
        50% { opacity: 0.5; width: 30px; height: 30px; }
        100% { opacity: 0.3; width: 20px; height: 20px; }
      }
      .rr-controller {
        width: 100%;
        height: 60px;
        background: #1a1a1a;
        display: flex;
        align-items: center;
        padding: 0 16px;
        gap: 16px;
      }
      .rr-controller__btns {
        display: flex;
        gap: 8px;
      }
      .rr-controller__btns button {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 8px;
        border-radius: 4px;
      }
      .rr-controller__btns button:hover {
        background: rgba(255,255,255,0.1);
      }
      .rr-progress {
        flex: 1;
        height: 4px;
        background: #333;
        border-radius: 2px;
        cursor: pointer;
      }
      .rr-progress__step {
        height: 100%;
        background: #4CAF50;
        border-radius: 2px;
      }
      .rr-controller__time {
        color: white;
        font-family: monospace;
        font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Create a simple replay viewer in a container.
 * Convenience function for quick setup.
 */
export async function createReplayViewer(
  container: HTMLElement,
  session: RrwebSession,
  options?: Partial<ReplayerConfig>
): Promise<GremlinReplayer> {
  const replayer = new GremlinReplayer({
    container,
    ...options,
  });

  await replayer.load(session);
  return replayer;
}
