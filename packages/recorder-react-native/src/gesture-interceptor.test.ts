import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GestureInterceptor, createGestureHandlers, type GestureEvent } from './gesture-interceptor';

// ============================================================================
// Helpers
// ============================================================================

function mockEvent(pageX: number, pageY: number, target?: any) {
  return {
    nativeEvent: { pageX, pageY, identifier: 0 },
    target: target ?? null,
  } as any;
}

function collectGestures(config?: Partial<{ minSwipeDistance: number; longPressDuration: number; doubleTapDelay: number }>) {
  const gestures: GestureEvent[] = [];
  const interceptor = new GestureInterceptor({
    onGesture: (g) => gestures.push(g),
    ...config,
  });
  return { interceptor, gestures };
}

// ============================================================================
// Tap Detection
// ============================================================================

describe('GestureInterceptor', () => {
  beforeEach(() => {
    // Use fake timers for long press / double tap tests
  });

  describe('tap detection', () => {
    it('emits a tap for a quick touch-start/touch-end at same position', () => {
      const { interceptor, gestures } = collectGestures();

      interceptor.handleTouchStart(mockEvent(100, 200));
      interceptor.handleTouchEnd(mockEvent(100, 200));

      expect(gestures).toHaveLength(1);
      expect(gestures[0].type).toBe('tap');
      expect(gestures[0].x).toBe(100);
      expect(gestures[0].y).toBe(200);
    });

    it('rounds coordinates to integers', () => {
      const { interceptor, gestures } = collectGestures();

      interceptor.handleTouchStart(mockEvent(100.7, 200.3));
      interceptor.handleTouchEnd(mockEvent(100.7, 200.3));

      expect(gestures[0].x).toBe(101);
      expect(gestures[0].y).toBe(200);
    });

    it('includes target from the event', () => {
      const target = { _nativeTag: 42 };
      const { interceptor, gestures } = collectGestures();

      interceptor.handleTouchStart(mockEvent(50, 50, target));
      interceptor.handleTouchEnd(mockEvent(50, 50, target));

      expect(gestures[0].target).toBe(target);
    });

    it('does not emit tap if finger moved more than 10px', () => {
      const { interceptor, gestures } = collectGestures();

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(115, 100)); // 15px movement

      expect(gestures).toHaveLength(0);
    });

    it('emits tap if finger moved less than 10px', () => {
      const { interceptor, gestures } = collectGestures();

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(105, 103)); // ~5.8px

      expect(gestures).toHaveLength(1);
      expect(gestures[0].type).toBe('tap');
    });

    it('has a timestamp on tap events', () => {
      const { interceptor, gestures } = collectGestures();
      const before = Date.now();

      interceptor.handleTouchStart(mockEvent(50, 50));
      interceptor.handleTouchEnd(mockEvent(50, 50));

      const after = Date.now();
      expect(gestures[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(gestures[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ============================================================================
  // Double Tap Detection
  // ============================================================================

  describe('double tap detection', () => {
    it('emits tap then double_tap for two quick taps at same position', () => {
      const { interceptor, gestures } = collectGestures({ doubleTapDelay: 500 });

      // First tap
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      expect(gestures).toHaveLength(1);
      expect(gestures[0].type).toBe('tap');

      // Second tap within doubleTapDelay
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      expect(gestures).toHaveLength(2);
      expect(gestures[1].type).toBe('double_tap');
    });

    it('emits two separate taps if second tap is too far away', () => {
      const { interceptor, gestures } = collectGestures({ doubleTapDelay: 500 });

      // First tap
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      // Second tap far away (>50px)
      interceptor.handleTouchStart(mockEvent(200, 200));
      interceptor.handleTouchEnd(mockEvent(200, 200));

      expect(gestures).toHaveLength(2);
      expect(gestures[0].type).toBe('tap');
      expect(gestures[1].type).toBe('tap');
    });

    it('resets after double tap — third tap is a new single tap', () => {
      const { interceptor, gestures } = collectGestures({ doubleTapDelay: 500 });

      // First tap
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      // Second tap → double_tap
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      // Third tap → new single tap (lastTap was cleared)
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      expect(gestures).toHaveLength(3);
      expect(gestures[0].type).toBe('tap');
      expect(gestures[1].type).toBe('double_tap');
      expect(gestures[2].type).toBe('tap');
    });

    it('double tap coordinates are from the second tap', () => {
      const { interceptor, gestures } = collectGestures({ doubleTapDelay: 500 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      interceptor.handleTouchStart(mockEvent(110, 110));
      interceptor.handleTouchEnd(mockEvent(110, 110));

      expect(gestures[1].type).toBe('double_tap');
      expect(gestures[1].x).toBe(110);
      expect(gestures[1].y).toBe(110);
    });
  });

  // ============================================================================
  // Long Press Detection
  // ============================================================================

  describe('long press detection', () => {
    it('emits long_press after longPressDuration elapses', async () => {
      const { interceptor, gestures } = collectGestures({ longPressDuration: 50 });

      interceptor.handleTouchStart(mockEvent(100, 200));

      // Wait for the timer to fire
      await new Promise((r) => setTimeout(r, 80));

      expect(gestures).toHaveLength(1);
      expect(gestures[0].type).toBe('long_press');
      expect(gestures[0].x).toBe(100);
      expect(gestures[0].y).toBe(200);

      // End the touch — should NOT emit a tap (already fired long press)
      interceptor.handleTouchEnd(mockEvent(100, 200));
      expect(gestures).toHaveLength(1); // Still 1, no tap
    });

    it('cancels long press if finger moves more than 10px', async () => {
      const { interceptor, gestures } = collectGestures({ longPressDuration: 50 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(120, 100)); // 20px movement

      await new Promise((r) => setTimeout(r, 80));

      // Long press should NOT have fired
      const longPresses = gestures.filter((g) => g.type === 'long_press');
      expect(longPresses).toHaveLength(0);
    });

    it('does not cancel long press for small movements (<10px)', async () => {
      const { interceptor, gestures } = collectGestures({ longPressDuration: 50 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(105, 103)); // ~5.8px

      await new Promise((r) => setTimeout(r, 80));

      const longPresses = gestures.filter((g) => g.type === 'long_press');
      expect(longPresses).toHaveLength(1);
    });

    it('cancels long press on touch cancel', async () => {
      const { interceptor, gestures } = collectGestures({ longPressDuration: 50 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchCancel();

      await new Promise((r) => setTimeout(r, 80));

      expect(gestures).toHaveLength(0);
    });
  });

  // ============================================================================
  // Swipe Detection
  // ============================================================================

  describe('swipe detection', () => {
    it('emits swipe when finger moves beyond minSwipeDistance', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(200, 100)); // 100px right
      interceptor.handleTouchEnd(mockEvent(200, 100));

      expect(gestures).toHaveLength(1);
      expect(gestures[0].type).toBe('swipe');
    });

    it('does not emit swipe below minSwipeDistance', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(115, 100)); // 15px
      interceptor.handleTouchEnd(mockEvent(115, 100));

      // Not a swipe and not a tap (moved > 10px)
      expect(gestures.filter((g) => g.type === 'swipe')).toHaveLength(0);
    });

    it('detects swipe right', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(200, 100));
      interceptor.handleTouchEnd(mockEvent(200, 100));

      expect(gestures[0].direction).toBe('right');
    });

    it('detects swipe left', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(200, 100));
      interceptor.handleTouchMove(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      expect(gestures[0].direction).toBe('left');
    });

    it('detects swipe down', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(100, 250));
      interceptor.handleTouchEnd(mockEvent(100, 250));

      expect(gestures[0].direction).toBe('down');
    });

    it('detects swipe up', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(100, 250));
      interceptor.handleTouchMove(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      expect(gestures[0].direction).toBe('up');
    });

    it('uses dominant axis for diagonal swipes', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      // More horizontal than vertical
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(200, 130));
      interceptor.handleTouchEnd(mockEvent(200, 130));

      expect(gestures[0].direction).toBe('right');
    });

    it('includes start/end coordinates and duration on swipe', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 30 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(250, 100));
      interceptor.handleTouchEnd(mockEvent(250, 100));

      const swipe = gestures[0];
      expect(swipe.startX).toBe(100);
      expect(swipe.startY).toBe(100);
      expect(swipe.endX).toBe(250);
      expect(swipe.endY).toBe(100);
      expect(swipe.duration).toBeGreaterThanOrEqual(0);
    });

    it('uses custom minSwipeDistance', () => {
      const { interceptor, gestures } = collectGestures({ minSwipeDistance: 100 });

      // 80px should NOT be a swipe with 100px threshold
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(180, 100));
      interceptor.handleTouchEnd(mockEvent(180, 100));

      expect(gestures.filter((g) => g.type === 'swipe')).toHaveLength(0);

      // 120px should be a swipe
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(220, 100));
      interceptor.handleTouchEnd(mockEvent(220, 100));

      expect(gestures.filter((g) => g.type === 'swipe')).toHaveLength(1);
    });
  });

  // ============================================================================
  // Touch Move Handling
  // ============================================================================

  describe('touch move', () => {
    it('does nothing if no touch start has occurred', () => {
      const { interceptor, gestures } = collectGestures();
      // Should not throw
      interceptor.handleTouchMove(mockEvent(100, 100));
      expect(gestures).toHaveLength(0);
    });
  });

  // ============================================================================
  // Touch End Edge Cases
  // ============================================================================

  describe('touch end edge cases', () => {
    it('does nothing if no touch start has occurred', () => {
      const { interceptor, gestures } = collectGestures();
      interceptor.handleTouchEnd(mockEvent(100, 100));
      expect(gestures).toHaveLength(0);
    });

    it('clears touch state after end', () => {
      const { interceptor, gestures } = collectGestures();

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      // Second end without start should be no-op
      interceptor.handleTouchEnd(mockEvent(100, 100));
      expect(gestures).toHaveLength(1); // Only the first tap
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('cleanup', () => {
    it('resets all state', async () => {
      const { interceptor, gestures } = collectGestures({ longPressDuration: 50 });

      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.cleanup();

      await new Promise((r) => setTimeout(r, 80));

      // Long press timer should have been cancelled
      expect(gestures).toHaveLength(0);
    });

    it('clears lastTap so next tap is not a double tap', () => {
      const { interceptor, gestures } = collectGestures({ doubleTapDelay: 500 });

      // First tap
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));
      expect(gestures[0].type).toBe('tap');

      interceptor.cleanup();

      // Second tap after cleanup — should be a new single tap, not double_tap
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchEnd(mockEvent(100, 100));

      expect(gestures).toHaveLength(2);
      expect(gestures[1].type).toBe('tap');
    });
  });

  // ============================================================================
  // createGestureHandlers
  // ============================================================================

  describe('createGestureHandlers', () => {
    it('returns touch handler props bound to the interceptor', () => {
      const { interceptor, gestures } = collectGestures();
      const handlers = createGestureHandlers(interceptor);

      expect(handlers.onTouchStart).toBe(interceptor.handleTouchStart);
      expect(handlers.onTouchMove).toBe(interceptor.handleTouchMove);
      expect(handlers.onTouchEnd).toBe(interceptor.handleTouchEnd);
      expect(handlers.onTouchCancel).toBe(interceptor.handleTouchCancel);
    });

    it('handlers work when called through the wrapper', () => {
      const { interceptor, gestures } = collectGestures();
      const handlers = createGestureHandlers(interceptor);

      handlers.onTouchStart(mockEvent(50, 50));
      handlers.onTouchEnd(mockEvent(50, 50));

      expect(gestures).toHaveLength(1);
      expect(gestures[0].type).toBe('tap');
    });
  });

  // ============================================================================
  // Default Config
  // ============================================================================

  describe('default config', () => {
    it('uses default minSwipeDistance of 30', () => {
      const { interceptor, gestures } = collectGestures();

      // 25px — below default, should not swipe
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(125, 100));
      interceptor.handleTouchEnd(mockEvent(125, 100));

      expect(gestures.filter((g) => g.type === 'swipe')).toHaveLength(0);

      // 40px — above default, should swipe
      interceptor.handleTouchStart(mockEvent(100, 100));
      interceptor.handleTouchMove(mockEvent(140, 100));
      interceptor.handleTouchEnd(mockEvent(140, 100));

      expect(gestures.filter((g) => g.type === 'swipe')).toHaveLength(1);
    });
  });
});
