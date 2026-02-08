/**
 * Performance Monitor - Track FPS, memory, and JS thread performance
 *
 * Uses React Native's performance APIs and requestAnimationFrame to monitor app performance.
 */

import { InteractionManager } from 'react-native';

// Local type definition
export interface PerformanceSample {
  timestamp?: number;
  fps?: number;
  memory?: number;
  jsThreadBusy?: boolean;
  jsThreadLag?: number;
  memoryUsage?: number;
  timeSinceNavigation?: number;
}

export interface PerformanceMonitorConfig {
  /** Sample interval (ms) */
  sampleInterval?: number;

  /** Callback for performance samples */
  onSample?: (sample: PerformanceSample) => void;

  /** Enable FPS tracking */
  trackFPS?: boolean;

  /** Enable memory tracking */
  trackMemory?: boolean;

  /** Enable JS thread lag tracking */
  trackJSLag?: boolean;
}

/**
 * PerformanceMonitor class to track app performance metrics
 */
export class PerformanceMonitor {
  private config: Required<PerformanceMonitorConfig>;
  private isRunning = false;

  // FPS tracking
  private frameCount = 0;
  private lastFrameTime = 0;
  private currentFPS = 60;
  private rafHandle: number | null = null;

  // JS thread lag tracking
  private lastInteractionTime = 0;
  private maxLagSinceLastSample = 0;
  private lagTimer: ReturnType<typeof setTimeout> | null = null;

  // Sample timer
  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  // Navigation tracking
  private lastNavigationTime = 0;

  constructor(config: PerformanceMonitorConfig = {}) {
    this.config = {
      sampleInterval: config.sampleInterval ?? 1000,
      onSample: config.onSample ?? (() => {}),
      trackFPS: config.trackFPS ?? true,
      trackMemory: config.trackMemory ?? true,
      trackJSLag: config.trackJSLag ?? true,
    };
  }

  /**
   * Start monitoring performance
   */
  public start(): void {
    if (this.isRunning) {
      console.warn('PerformanceMonitor: Already running');
      return;
    }

    this.isRunning = true;
    this.lastFrameTime = Date.now();
    this.lastInteractionTime = Date.now();

    // Start FPS tracking
    if (this.config.trackFPS) {
      this.startFPSTracking();
    }

    // Start JS lag tracking
    if (this.config.trackJSLag) {
      this.startJSLagTracking();
    }

    // Start periodic sampling
    this.sampleTimer = setInterval(() => {
      this.takeSample();
    }, this.config.sampleInterval);
  }

  /**
   * Stop monitoring performance
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Stop FPS tracking
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    // Stop JS lag tracking
    if (this.lagTimer !== null) {
      clearTimeout(this.lagTimer);
      this.lagTimer = null;
    }

    // Stop sample timer
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  /**
   * Get current performance sample
   */
  public getCurrentSample(): PerformanceSample {
    const sample: PerformanceSample = {};

    if (this.config.trackFPS) {
      sample.fps = Math.round(this.currentFPS);
    }

    if (this.config.trackJSLag) {
      sample.jsThreadLag = Math.round(this.maxLagSinceLastSample);
      // Reset so subsequent calls don't report stale lag values
      this.maxLagSinceLastSample = 0;
    }

    if (this.config.trackMemory) {
      sample.memoryUsage = this.getMemoryUsage();
    }

    if (this.lastNavigationTime > 0) {
      sample.timeSinceNavigation = Date.now() - this.lastNavigationTime;
    }

    return sample;
  }

  /**
   * Mark navigation event (for timeSinceNavigation tracking)
   */
  public markNavigation(): void {
    this.lastNavigationTime = Date.now();
  }

  /**
   * Reset navigation timer
   */
  public resetNavigationTimer(): void {
    this.lastNavigationTime = 0;
  }

  // ========================================================================
  // Private Methods - FPS Tracking
  // ========================================================================

  private startFPSTracking(): void {
    const measureFrame = () => {
      if (!this.isRunning) return;

      const now = Date.now();
      const delta = now - this.lastFrameTime;

      if (delta > 0) {
        this.frameCount++;

        // Calculate FPS every second
        if (delta >= 1000) {
          this.currentFPS = (this.frameCount / delta) * 1000;
          this.frameCount = 0;
          this.lastFrameTime = now;
        }
      }

      this.rafHandle = requestAnimationFrame(measureFrame);
    };

    this.rafHandle = requestAnimationFrame(measureFrame);
  }

  // ========================================================================
  // Private Methods - JS Thread Lag Tracking
  // ========================================================================

  private static readonly LAG_CHECK_INTERVAL = 100;

  private startJSLagTracking(): void {
    // Use InteractionManager to detect when JS thread is busy.
    // Subtract the expected timer interval so idle lag reports ~0ms.
    const checkLag = () => {
      if (!this.isRunning) return;

      const now = Date.now();
      const elapsed = now - this.lastInteractionTime;
      const lag = Math.max(0, elapsed - PerformanceMonitor.LAG_CHECK_INTERVAL);

      // Update max lag
      if (lag > this.maxLagSinceLastSample) {
        this.maxLagSinceLastSample = lag;
      }

      this.lastInteractionTime = now;

      // Schedule next check after runAfterInteractions
      InteractionManager.runAfterInteractions(() => {
        if (!this.isRunning) return;
        this.lagTimer = setTimeout(checkLag, PerformanceMonitor.LAG_CHECK_INTERVAL);
      });
    };

    checkLag();
  }

  // ========================================================================
  // Private Methods - Memory Tracking
  // ========================================================================

  private getMemoryUsage(): number | undefined {
    try {
      // React Native doesn't expose memory info directly in JS
      // This would need a native module or use performance.memory on supported platforms

      // On Web (React Native Web), we can use performance.memory
      if (typeof performance !== 'undefined' && 'memory' in performance) {
        const memory = (performance as any).memory;
        return Math.round(memory.usedJSHeapSize / 1024 / 1024); // MB
      }

      // On Hermes, we might have global.HermesInternal
      if (typeof global !== 'undefined' && 'HermesInternal' in global) {
        const hermes = (global as any).HermesInternal;
        if (hermes?.getInstrumentedStats) {
          const stats = hermes.getInstrumentedStats();
          return Math.round(stats.js_allocatedSize / 1024 / 1024); // MB
        }
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  // ========================================================================
  // Private Methods - Sampling
  // ========================================================================

  private takeSample(): void {
    const sample = this.getCurrentSample();

    // Emit sample (getCurrentSample already resets maxLagSinceLastSample)
    this.config.onSample(sample);
  }
}

/**
 * Create a performance monitor with default config
 */
export function createPerformanceMonitor(
  config?: PerformanceMonitorConfig
): PerformanceMonitor {
  return new PerformanceMonitor(config);
}
