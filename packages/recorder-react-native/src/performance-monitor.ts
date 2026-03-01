/**
 * Performance Monitor - Track FPS, memory, and JS thread performance
 *
 * Uses React Native's performance APIs and requestAnimationFrame to monitor app performance.
 */

import { InteractionManager } from 'react-native';

import type { PerformanceSample } from '@gremlin/session';

interface PerformanceMonitorConfig {
  /** ms */
  sampleInterval?: number;
  onSample?: (sample: PerformanceSample) => void;
  trackFPS?: boolean;
  trackMemory?: boolean;
  trackJSLag?: boolean;
}

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

  public getCurrentSample(): PerformanceSample {
    const sample: PerformanceSample = {};

    if (this.config.trackFPS) {
      sample.fps = Math.round(this.currentFPS);
    }

    if (this.config.trackJSLag) {
      sample.jsThreadLag = Math.round(this.maxLagSinceLastSample);
      // Don't reset here — lag accumulates until markNavigation or periodic reset
    }

    if (this.config.trackMemory) {
      sample.memoryUsage = this.getMemoryUsage();
    }

    if (this.lastNavigationTime > 0) {
      sample.timeSinceNavigation = Date.now() - this.lastNavigationTime;
    }

    return sample;
  }

  /** Resets timeSinceNavigation and JS lag counters. */
  public markNavigation(): void {
    this.lastNavigationTime = Date.now();
    this.maxLagSinceLastSample = 0;
  }

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

  private startJSLagTracking(): void {
    // Use InteractionManager to detect when JS thread is busy
    const checkLag = () => {
      if (!this.isRunning) return;

      const now = Date.now();
      const lag = now - this.lastInteractionTime;

      // Update max lag
      if (lag > this.maxLagSinceLastSample) {
        this.maxLagSinceLastSample = lag;
      }

      this.lastInteractionTime = now;

      // Schedule next check after runAfterInteractions
      InteractionManager.runAfterInteractions(() => {
        if (!this.isRunning) return;
        this.lagTimer = setTimeout(checkLag, 100);
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

export function createPerformanceMonitor(
  config?: PerformanceMonitorConfig
): PerformanceMonitor {
  return new PerformanceMonitor(config);
}
