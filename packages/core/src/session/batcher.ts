/**
 * Event Batcher - Platform-agnostic batching logic
 *
 * Handles scroll coalescing with timer-based flush.
 * Platform recorders wire up lifecycle events (visibility, app state) to trigger flush.
 */

import type { GremlinEvent, ScrollEvent } from './types';
import { EventTypeEnum } from './types';

// ============================================================================
// Types
// ============================================================================

export interface ScrollBatch {
  totalDeltaX: number;
  totalDeltaY: number;
  startTime: number;
  lastTime: number;
  eventCount: number;
}

export interface BatcherConfig {
  /** Scroll batching window in ms (default: 150) */
  scrollBatchWindow: number;
  /** Enable batching (default: true) */
  enabled: boolean;
  /** Debug logging */
  debug?: boolean;
}

export interface BatcherCallbacks {
  /** Called when a batched event should be emitted */
  onEmit: (event: Omit<GremlinEvent, 'dt'>) => void;
}

// ============================================================================
// EventBatcher
// ============================================================================

/**
 * Handles event batching logic.
 * Platform recorders should:
 * 1. Call addScroll() for each raw scroll event
 * 2. Call flush() on lifecycle events (background, stop, visibility hidden)
 * 3. Call destroy() on cleanup
 */
export class EventBatcher {
  private config: BatcherConfig;
  private callbacks: BatcherCallbacks;
  private scrollBatch: ScrollBatch | null = null;
  private scrollFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<BatcherConfig>, callbacks: BatcherCallbacks) {
    this.config = {
      scrollBatchWindow: config.scrollBatchWindow ?? 150,
      enabled: config.enabled ?? true,
      debug: config.debug ?? false,
    };
    this.callbacks = callbacks;
  }

  /**
   * Add a scroll event to the batch.
   * Will either batch or emit immediately based on config.
   */
  addScroll(deltaX: number, deltaY: number): void {
    const now = Date.now();

    // If batching disabled, emit immediately
    if (!this.config.enabled) {
      this.emitScrollEvent(deltaX, deltaY);
      return;
    }

    // Batching: accumulate scroll events and flush after window expires
    if (this.scrollBatch) {
      // Accumulate deltas (not replace)
      this.scrollBatch.totalDeltaX += deltaX;
      this.scrollBatch.totalDeltaY += deltaY;
      this.scrollBatch.lastTime = now;
      this.scrollBatch.eventCount++;
    } else {
      // Start new batch
      this.scrollBatch = {
        totalDeltaX: deltaX,
        totalDeltaY: deltaY,
        startTime: now,
        lastTime: now,
        eventCount: 1,
      };
    }

    // Reset flush timer
    if (this.scrollFlushTimer !== null) {
      clearTimeout(this.scrollFlushTimer);
    }

    // Schedule flush after batch window
    this.scrollFlushTimer = setTimeout(() => {
      this.flushScroll();
    }, this.config.scrollBatchWindow);
  }

  /**
   * Flush any pending scroll batch.
   * Call this on: stop(), background, visibility hidden, etc.
   */
  flush(): void {
    this.flushScroll();
  }

  /**
   * Clean up timers. Call on destroy/unmount.
   */
  destroy(): void {
    if (this.scrollFlushTimer !== null) {
      clearTimeout(this.scrollFlushTimer);
      this.scrollFlushTimer = null;
    }
    this.scrollBatch = null;
  }

  /**
   * Check if there's a pending batch
   */
  hasPendingBatch(): boolean {
    return this.scrollBatch !== null;
  }

  // ========================================================================
  // Private
  // ========================================================================

  private flushScroll(): void {
    if (!this.scrollBatch) {
      return;
    }

    const batch = this.scrollBatch;
    this.scrollBatch = null;

    if (this.scrollFlushTimer !== null) {
      clearTimeout(this.scrollFlushTimer);
      this.scrollFlushTimer = null;
    }

    if (this.config.debug) {
      console.log('[Batcher] Flushing scroll batch', {
        events: batch.eventCount,
        deltaX: batch.totalDeltaX,
        deltaY: batch.totalDeltaY,
      });
    }

    // Emit single coalesced scroll event
    this.emitScrollEvent(batch.totalDeltaX, batch.totalDeltaY, batch.eventCount);
  }

  private emitScrollEvent(deltaX: number, deltaY: number, coalescedCount?: number): void {
    const event: Omit<GremlinEvent, 'dt'> = {
      type: EventTypeEnum.SCROLL,
      data: {
        kind: 'scroll',
        deltaX: Math.round(deltaX),
        deltaY: Math.round(deltaY),
        ...(coalescedCount && coalescedCount > 1 ? { coalesced: coalescedCount } : {}),
      } as ScrollEvent,
    };

    this.callbacks.onEmit(event);
  }
}
