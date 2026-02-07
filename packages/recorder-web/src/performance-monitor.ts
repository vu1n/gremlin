/**
 * Web Performance Monitor
 *
 * Tracks FPS, long tasks, Web Vitals, and memory usage in the browser.
 * Modeled on the RN PerformanceMonitor with the same API shape.
 */

import type { PerformanceSample, WebVitals, SessionPerformance } from '@gremlin/session';

// ============================================================================
// Types
// ============================================================================

export interface WebPerformanceMonitorConfig {
  /** Enable FPS tracking via requestAnimationFrame */
  trackFPS?: boolean;

  /** Enable long task tracking via PerformanceObserver */
  trackLongTasks?: boolean;

  /** Enable Web Vitals (LCP, CLS, INP, FCP, TTFB) */
  trackWebVitals?: boolean;

  /** Enable memory tracking (Chrome only) */
  trackMemory?: boolean;
}

// ============================================================================
// Monitor
// ============================================================================

export class WebPerformanceMonitor {
  private config: Required<WebPerformanceMonitorConfig>;
  private isRunning = false;

  // FPS tracking
  private frameCount = 0;
  private lastFrameTime = 0;
  private currentFPS = 60;
  private rafHandle: number | null = null;
  private minFps = 60;
  private fpsSamples: number[] = [];

  // Long task tracking
  private longTaskObserver: PerformanceObserver | null = null;
  private sampleLongTaskCount = 0;
  private sampleLongTaskDuration = 0;
  private totalLongTaskCount = 0;
  private totalLongTaskDuration = 0;

  // Web Vitals
  private webVitals: WebVitals = {};

  // Memory tracking
  private peakMemoryUsage = 0;

  // Navigation tracking
  private lastNavigationTime = 0;

  constructor(config: WebPerformanceMonitorConfig = {}) {
    this.config = {
      trackFPS: config.trackFPS ?? true,
      trackLongTasks: config.trackLongTasks ?? true,
      trackWebVitals: config.trackWebVitals ?? true,
      trackMemory: config.trackMemory ?? true,
    };
  }

  /**
   * Start all monitoring subsystems.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastNavigationTime = Date.now();

    if (this.config.trackFPS) {
      this.startFPSTracking();
    }

    if (this.config.trackLongTasks) {
      this.startLongTaskTracking();
    }

    if (this.config.trackWebVitals) {
      this.startWebVitals();
    }
  }

  /**
   * Stop all monitoring subsystems.
   */
  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
      this.longTaskObserver = null;
    }
  }

  /**
   * Get a per-event performance sample. Resets per-sample counters.
   */
  public getCurrentSample(): PerformanceSample {
    const sample: PerformanceSample = {};

    if (this.config.trackFPS) {
      sample.fps = Math.round(this.currentFPS);
    }

    if (this.config.trackLongTasks) {
      sample.longTaskCount = this.sampleLongTaskCount;
      sample.longTaskTotalDuration = Math.round(this.sampleLongTaskDuration);
      // Reset per-sample counters
      this.sampleLongTaskCount = 0;
      this.sampleLongTaskDuration = 0;
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
   * Get session-level performance summary.
   */
  public getSessionPerformance(): SessionPerformance {
    const perf: SessionPerformance = {};

    if (this.config.trackWebVitals && Object.keys(this.webVitals).length > 0) {
      perf.webVitals = { ...this.webVitals };
    }

    if (this.config.trackLongTasks) {
      perf.longTaskCount = this.totalLongTaskCount;
      perf.longTaskTotalDuration = Math.round(this.totalLongTaskDuration);
    }

    if (this.config.trackFPS && this.fpsSamples.length > 0) {
      perf.avgFps = Math.round(
        this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
      );
      perf.minFps = Math.round(this.minFps);
    }

    if (this.config.trackMemory && this.peakMemoryUsage > 0) {
      perf.peakMemoryUsage = this.peakMemoryUsage;
    }

    // Page load time from navigation timing
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav) {
        perf.pageLoadTime = Math.round(nav.loadEventEnd - nav.startTime);
      }
    } catch {
      // Not available
    }

    return perf;
  }

  /**
   * Mark a navigation event (resets timeSinceNavigation).
   */
  public markNavigation(): void {
    this.lastNavigationTime = Date.now();
  }

  // ========================================================================
  // FPS Tracking
  // ========================================================================

  private startFPSTracking(): void {
    this.lastFrameTime = performance.now();
    this.frameCount = 0;

    const measureFrame = (now: number) => {
      if (!this.isRunning) return;

      this.frameCount++;
      const delta = now - this.lastFrameTime;

      // Calculate FPS every second
      if (delta >= 1000) {
        this.currentFPS = (this.frameCount / delta) * 1000;
        this.fpsSamples.push(this.currentFPS);
        if (this.currentFPS < this.minFps) {
          this.minFps = this.currentFPS;
        }
        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      this.rafHandle = requestAnimationFrame(measureFrame);
    };

    this.rafHandle = requestAnimationFrame(measureFrame);
  }

  // ========================================================================
  // Long Task Tracking
  // ========================================================================

  private startLongTaskTracking(): void {
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.sampleLongTaskCount++;
          this.sampleLongTaskDuration += entry.duration;
          this.totalLongTaskCount++;
          this.totalLongTaskDuration += entry.duration;
        }
      });

      this.longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      // PerformanceObserver or longtask not supported (e.g. Firefox)
      this.longTaskObserver = null;
    }
  }

  // ========================================================================
  // Web Vitals
  // ========================================================================

  private async startWebVitals(): Promise<void> {
    try {
      const webVitals = await import('web-vitals');

      webVitals.onLCP((metric) => {
        this.webVitals.lcp = Math.round(metric.value);
      });

      webVitals.onCLS((metric) => {
        this.webVitals.cls = Math.round(metric.value * 1000) / 1000;
      }, { reportAllChanges: true });

      webVitals.onINP((metric) => {
        this.webVitals.inp = Math.round(metric.value);
      }, { reportAllChanges: true });

      webVitals.onFCP((metric) => {
        this.webVitals.fcp = Math.round(metric.value);
      });

      webVitals.onTTFB((metric) => {
        this.webVitals.ttfb = Math.round(metric.value);
      });
    } catch {
      // web-vitals not available
    }
  }

  // ========================================================================
  // Memory Tracking
  // ========================================================================

  private getMemoryUsage(): number | undefined {
    try {
      if (typeof performance !== 'undefined' && 'memory' in performance) {
        const memory = (performance as any).memory;
        const mb = Math.round(memory.usedJSHeapSize / 1024 / 1024);
        if (mb > this.peakMemoryUsage) {
          this.peakMemoryUsage = mb;
        }
        return mb;
      }
    } catch {
      // Not available
    }
    return undefined;
  }
}
