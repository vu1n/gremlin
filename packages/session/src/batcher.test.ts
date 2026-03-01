import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { EventBatcher } from './batcher.ts';
import type { GremlinEvent } from './types.ts';
import { EventTypeEnum } from './types.ts';

describe('EventBatcher', () => {
  let emitted: Omit<GremlinEvent, 'dt'>[];
  let batcher: EventBatcher;

  function createBatcher(config: { enabled?: boolean; scrollBatchWindow?: number } = {}) {
    return new EventBatcher(
      {
        scrollBatchWindow: config.scrollBatchWindow ?? 150,
        enabled: config.enabled ?? true,
      },
      {
        onEmit: (event) => emitted.push(event),
      }
    );
  }

  beforeEach(() => {
    emitted = [];
    batcher = createBatcher();
  });

  afterEach(() => {
    batcher.destroy();
  });

  describe('batching enabled (default)', () => {
    it('does not emit immediately when adding a scroll', () => {
      batcher.addScroll(0, 10);
      expect(emitted).toHaveLength(0);
      expect(batcher.hasPendingBatch()).toBe(true);
    });

    it('coalesces multiple scrolls into one event on flush', () => {
      batcher.addScroll(0, 10);
      batcher.addScroll(0, 20);
      batcher.addScroll(5, 30);

      batcher.flush();

      expect(emitted).toHaveLength(1);
      const data = emitted[0].data as { kind: string; deltaX: number; deltaY: number; coalesced?: number };
      expect(data.kind).toBe('scroll');
      expect(data.deltaX).toBe(5);
      expect(data.deltaY).toBe(60);
      expect(data.coalesced).toBe(3);
    });

    it('emits after batch window timer expires', async () => {
      const shortBatcher = createBatcher({ scrollBatchWindow: 50 });
      shortBatcher.addScroll(0, 100);

      expect(emitted).toHaveLength(0);

      // Wait for the batch window to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(emitted).toHaveLength(1);
      const data = emitted[0].data as { deltaY: number };
      expect(data.deltaY).toBe(100);

      shortBatcher.destroy();
    });

    it('does not set coalesced when only one event', () => {
      batcher.addScroll(10, 20);
      batcher.flush();

      expect(emitted).toHaveLength(1);
      const data = emitted[0].data as { coalesced?: number };
      expect(data.coalesced).toBeUndefined();
    });

    it('hasPendingBatch returns false after flush', () => {
      batcher.addScroll(0, 10);
      expect(batcher.hasPendingBatch()).toBe(true);
      batcher.flush();
      expect(batcher.hasPendingBatch()).toBe(false);
    });

    it('empty flush produces no events', () => {
      batcher.flush();
      expect(emitted).toHaveLength(0);
    });

    it('rounds delta values', () => {
      batcher.addScroll(1.7, 3.3);
      batcher.flush();

      const data = emitted[0].data as { deltaX: number; deltaY: number };
      expect(data.deltaX).toBe(2);
      expect(data.deltaY).toBe(3);
    });

    it('handles multiple flush cycles', () => {
      batcher.addScroll(0, 10);
      batcher.flush();

      batcher.addScroll(0, 20);
      batcher.flush();

      expect(emitted).toHaveLength(2);
      expect((emitted[0].data as { deltaY: number }).deltaY).toBe(10);
      expect((emitted[1].data as { deltaY: number }).deltaY).toBe(20);
    });
  });

  describe('batching disabled', () => {
    it('emits scroll events immediately', () => {
      const noBatch = createBatcher({ enabled: false });

      noBatch.addScroll(0, 10);
      expect(emitted).toHaveLength(1);

      noBatch.addScroll(0, 20);
      expect(emitted).toHaveLength(2);

      noBatch.destroy();
    });

    it('does not coalesce when batching is disabled', () => {
      const noBatch = createBatcher({ enabled: false });

      noBatch.addScroll(0, 10);
      noBatch.addScroll(0, 20);

      expect(emitted).toHaveLength(2);
      expect((emitted[0].data as { deltaY: number }).deltaY).toBe(10);
      expect((emitted[1].data as { deltaY: number }).deltaY).toBe(20);

      noBatch.destroy();
    });

    it('does not set coalesced count when emitting immediately', () => {
      const noBatch = createBatcher({ enabled: false });
      noBatch.addScroll(5, 10);

      const data = emitted[0].data as { coalesced?: number };
      expect(data.coalesced).toBeUndefined();

      noBatch.destroy();
    });
  });

  describe('destroy', () => {
    it('clears pending batch on destroy', () => {
      batcher.addScroll(0, 10);
      expect(batcher.hasPendingBatch()).toBe(true);

      batcher.destroy();
      expect(batcher.hasPendingBatch()).toBe(false);
    });

    it('flushes pending events on destroy', () => {
      batcher.addScroll(0, 10);
      batcher.destroy();
      expect(emitted).toHaveLength(1);
    });
  });

  describe('event format', () => {
    it('emits events with correct type', () => {
      batcher.addScroll(10, 20);
      batcher.flush();

      expect(emitted[0].type).toBe(EventTypeEnum.SCROLL);
    });

    it('emits events with scroll kind', () => {
      batcher.addScroll(10, 20);
      batcher.flush();

      expect((emitted[0].data as { kind: string }).kind).toBe('scroll');
    });
  });
});
