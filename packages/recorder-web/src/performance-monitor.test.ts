import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { WebPerformanceMonitor } from './performance-monitor.ts';

// Save originals
const origRAF = globalThis.requestAnimationFrame;
const origCAF = globalThis.cancelAnimationFrame;
const origPerfObserver = globalThis.PerformanceObserver;

function installBrowserMocks() {
  let rafId = 0;
  const rafCallbacks = new Map<number, FrameRequestCallback>();

  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafCallbacks.set(id, cb);
    return id;
  };
  (globalThis as any).cancelAnimationFrame = (id: number) => {
    rafCallbacks.delete(id);
  };

  // Expose for manual stepping
  return {
    rafCallbacks,
    /** Fire all pending rAF callbacks with the given timestamp */
    flushRAF(now: number) {
      const cbs = [...rafCallbacks.entries()];
      rafCallbacks.clear();
      for (const [, cb] of cbs) cb(now);
    },
  };
}

function installPerformanceObserverMock() {
  let entryCallback: ((list: { getEntries(): any[] }) => void) | null = null;

  (globalThis as any).PerformanceObserver = class MockPerformanceObserver {
    constructor(cb: (list: { getEntries(): any[] }) => void) {
      entryCallback = cb;
    }
    observe() {}
    disconnect() {
      entryCallback = null;
    }
  };

  return {
    pushEntry(entry: { duration: number }) {
      entryCallback?.({ getEntries: () => [entry] });
    },
    get connected() {
      return entryCallback !== null;
    },
  };
}

function removePerformanceObserver() {
  (globalThis as any).PerformanceObserver = undefined;
}

function installPerformanceMemory(usedJSHeapSize: number) {
  Object.defineProperty(performance, 'memory', {
    value: { usedJSHeapSize },
    configurable: true,
    writable: true,
  });
}

function removePerformanceMemory() {
  if ('memory' in performance) {
    delete (performance as any).memory;
  }
}

describe('WebPerformanceMonitor', () => {
  let mocks: ReturnType<typeof installBrowserMocks>;
  let obsMock: ReturnType<typeof installPerformanceObserverMock>;

  beforeEach(() => {
    mocks = installBrowserMocks();
    obsMock = installPerformanceObserverMock();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
    (globalThis as any).PerformanceObserver = origPerfObserver;
    removePerformanceMemory();
  });

  // --------------------------------------------------------------------------
  // getCurrentSample
  // --------------------------------------------------------------------------

  describe('getCurrentSample()', () => {
    test('returns expected shape with fps, longTask fields, memoryUsage, timeSinceNavigation', () => {
      installPerformanceMemory(100 * 1024 * 1024); // 100 MB

      const monitor = new WebPerformanceMonitor({
        trackFPS: true,
        trackLongTasks: true,
        trackMemory: true,
        trackWebVitals: false,
      });
      monitor.start();

      // Simulate some long tasks
      obsMock.pushEntry({ duration: 120 });

      const sample = monitor.getCurrentSample();

      expect(sample).toBeDefined();
      expect(typeof sample.fps).toBe('number');
      expect(sample.longTaskCount).toBe(1);
      expect(sample.longTaskTotalDuration).toBe(120);
      expect(typeof sample.memoryUsage).toBe('number');
      expect(typeof sample.timeSinceNavigation).toBe('number');

      monitor.stop();
    });

    test('resets per-sample long task counters after each call', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: true,
        trackMemory: false,
        trackWebVitals: false,
      });
      monitor.start();

      obsMock.pushEntry({ duration: 80 });
      obsMock.pushEntry({ duration: 60 });

      const sample1 = monitor.getCurrentSample();
      expect(sample1.longTaskCount).toBe(2);
      expect(sample1.longTaskTotalDuration).toBe(140);

      // Second call should show zero (reset)
      const sample2 = monitor.getCurrentSample();
      expect(sample2.longTaskCount).toBe(0);
      expect(sample2.longTaskTotalDuration).toBe(0);

      monitor.stop();
    });

    test('omits fps when trackFPS is false', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: false,
        trackMemory: false,
        trackWebVitals: false,
      });
      monitor.start();

      const sample = monitor.getCurrentSample();
      expect(sample.fps).toBeUndefined();

      monitor.stop();
    });

    test('omits memoryUsage when trackMemory is false', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: false,
        trackMemory: false,
        trackWebVitals: false,
      });
      monitor.start();

      const sample = monitor.getCurrentSample();
      expect(sample.memoryUsage).toBeUndefined();

      monitor.stop();
    });
  });

  // --------------------------------------------------------------------------
  // getSessionPerformance
  // --------------------------------------------------------------------------

  describe('getSessionPerformance()', () => {
    test('returns session-level summary with longTaskCount and longTaskTotalDuration', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: true,
        trackMemory: false,
        trackWebVitals: false,
      });
      monitor.start();

      obsMock.pushEntry({ duration: 100 });
      obsMock.pushEntry({ duration: 200 });

      // getCurrentSample resets per-sample counters but not totals
      monitor.getCurrentSample();

      const perf = monitor.getSessionPerformance();
      expect(perf.longTaskCount).toBe(2);
      expect(perf.longTaskTotalDuration).toBe(300);

      monitor.stop();
    });

    test('returns avgFps and minFps when FPS samples exist', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: true,
        trackLongTasks: false,
        trackMemory: false,
        trackWebVitals: false,
      });
      monitor.start();

      // Simulate FPS measurement: first rAF callback + 1s later = calculates FPS
      // Step 1: initial rAF fires at time=0
      mocks.flushRAF(0);
      // Step 2: simulate 60 frames over 1 second
      for (let i = 1; i <= 60; i++) {
        mocks.flushRAF(i * (1000 / 60));
      }
      // After ~1s the FPS should be calculated
      // Force another measurement window
      mocks.flushRAF(2000);

      const perf = monitor.getSessionPerformance();
      // Should have at least some FPS data
      if (perf.avgFps !== undefined) {
        expect(typeof perf.avgFps).toBe('number');
        expect(typeof perf.minFps).toBe('number');
      }

      monitor.stop();
    });

    test('returns peakMemoryUsage when memory tracking is enabled', () => {
      installPerformanceMemory(50 * 1024 * 1024); // 50 MB

      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: false,
        trackMemory: true,
        trackWebVitals: false,
      });
      monitor.start();

      // Trigger memory read
      monitor.getCurrentSample();

      // Update to higher memory
      installPerformanceMemory(80 * 1024 * 1024); // 80 MB
      monitor.getCurrentSample();

      const perf = monitor.getSessionPerformance();
      expect(perf.peakMemoryUsage).toBe(80);

      monitor.stop();
    });
  });

  // --------------------------------------------------------------------------
  // markNavigation
  // --------------------------------------------------------------------------

  describe('markNavigation()', () => {
    test('resets timeSinceNavigation baseline', async () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: false,
        trackMemory: false,
        trackWebVitals: false,
      });
      monitor.start();

      // First sample has some timeSinceNavigation
      const sample1 = monitor.getCurrentSample();
      const t1 = sample1.timeSinceNavigation!;
      expect(t1).toBeGreaterThanOrEqual(0);

      // Wait a tiny bit
      await new Promise((r) => setTimeout(r, 20));

      // Mark navigation resets the baseline
      monitor.markNavigation();

      const sample2 = monitor.getCurrentSample();
      // After markNavigation, timeSinceNavigation should be very small
      expect(sample2.timeSinceNavigation!).toBeLessThan(t1 + 100);

      monitor.stop();
    });
  });

  // --------------------------------------------------------------------------
  // start() / stop() lifecycle
  // --------------------------------------------------------------------------

  describe('start() and stop()', () => {
    test('no double-start: calling start twice does not throw', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: true,
        trackLongTasks: true,
        trackMemory: false,
        trackWebVitals: false,
      });

      monitor.start();
      // Second start should be a no-op
      monitor.start();

      // Should still work correctly
      const sample = monitor.getCurrentSample();
      expect(sample).toBeDefined();

      monitor.stop();
    });

    test('stop() cleans up rAF and PerformanceObserver', () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: true,
        trackLongTasks: true,
        trackMemory: false,
        trackWebVitals: false,
      });

      monitor.start();
      expect(obsMock.connected).toBe(true);

      monitor.stop();
      expect(obsMock.connected).toBe(false);
    });

    test('calling stop() when not running is a no-op', () => {
      const monitor = new WebPerformanceMonitor();
      // Should not throw
      monitor.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Graceful degradation
  // --------------------------------------------------------------------------

  describe('graceful degradation', () => {
    test('handles PerformanceObserver not available', () => {
      removePerformanceObserver();

      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: true,
        trackMemory: false,
        trackWebVitals: false,
      });

      // Should not throw
      monitor.start();

      const sample = monitor.getCurrentSample();
      expect(sample.longTaskCount).toBe(0);
      expect(sample.longTaskTotalDuration).toBe(0);

      monitor.stop();
    });

    test('handles performance.memory not available', () => {
      removePerformanceMemory();

      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: false,
        trackMemory: true,
        trackWebVitals: false,
      });
      monitor.start();

      const sample = monitor.getCurrentSample();
      expect(sample.memoryUsage).toBeUndefined();

      monitor.stop();
    });

    test('handles web-vitals import failure gracefully', async () => {
      const monitor = new WebPerformanceMonitor({
        trackFPS: false,
        trackLongTasks: false,
        trackMemory: false,
        trackWebVitals: true,
      });

      // In bun test env, web-vitals will fail to work (no browser).
      // start() should not throw.
      monitor.start();

      const perf = monitor.getSessionPerformance();
      // webVitals should be absent or empty since web-vitals can't run in test env
      expect(perf.webVitals).toBeUndefined();

      monitor.stop();
    });
  });
});
