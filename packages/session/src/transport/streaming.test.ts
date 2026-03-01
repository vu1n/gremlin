/**
 * StreamingTransport integration tests
 *
 * Tests flush batching, stop-during-flush safety, retry logic,
 * event ordering, and concurrent append safety.
 * Uses a real Bun HTTP server as the mock endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { StreamingTransport } from './streaming.ts';
import type { GremlinEvent } from '../types.ts';

// ============================================================================
// Mock Server
// ============================================================================

interface ReceivedPayload {
  sessionId: string;
  events: any[];
  rrwebEvents: any[];
}

let mockServer: ReturnType<typeof Bun.serve>;
let mockUrl: string;
let receivedPayloads: ReceivedPayload[];
let shouldFail: boolean;
let failCount: number;
let failsRemaining: number;
let requestCount: number;

beforeAll(() => {
  receivedPayloads = [];
  shouldFail = false;
  failCount = 0;
  failsRemaining = 0;
  requestCount = 0;

  mockServer = Bun.serve({
    port: 0,
    async fetch(req) {
      requestCount++;
      const url = new URL(req.url);

      // Match /v1/sessions/:id/events (append endpoint)
      const eventsMatch = url.pathname.match(/^\/v1\/sessions\/[^/]+\/events$/);
      if (eventsMatch && req.method === 'POST') {
        if (shouldFail || failsRemaining > 0) {
          if (failsRemaining > 0) failsRemaining--;
          failCount++;
          return new Response('Server Error', { status: 500 });
        }

        const body = await req.json();
        receivedPayloads.push(body);
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/v1/sessions' && req.method === 'POST') {
        if (shouldFail) {
          return new Response('Server Error', { status: 500 });
        }
        const body = await req.json();
        receivedPayloads.push(body);
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  mockUrl = `http://localhost:${mockServer.port}`;
});

afterAll(() => {
  mockServer?.stop(true);
});

beforeEach(() => {
  receivedPayloads = [];
  shouldFail = false;
  failCount = 0;
  failsRemaining = 0;
  requestCount = 0;
});

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(dt: number = 0): GremlinEvent {
  return { dt, type: 0, data: { kind: 'tap', x: Math.random() * 100, y: Math.random() * 100 } } as GremlinEvent;
}

function waitMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Tests: Basic Start/Stop
// ============================================================================

describe('StreamingTransport lifecycle', () => {
  it('starts and stops without errors', () => {
    const transport = new StreamingTransport({ endpoint: mockUrl, batchInterval: 100 });
    transport.start('session-1');
    transport.stop();
  });

  it('stop() is safe to call without start()', () => {
    const transport = new StreamingTransport({ endpoint: mockUrl });
    transport.stop(); // Should not throw
  });

  it('can be restarted with a new session', async () => {
    const transport = new StreamingTransport({ endpoint: mockUrl, batchInterval: 50 });

    transport.start('session-a');
    transport.pushEvent(makeEvent());
    transport.stop();
    await waitMs(100);

    transport.start('session-b');
    transport.pushEvent(makeEvent());
    transport.stop();
    await waitMs(100);

    // Both sessions should have sent payloads
    const sessionIds = receivedPayloads.map(p => p.sessionId);
    expect(sessionIds).toContain('session-a');
    expect(sessionIds).toContain('session-b');
  });
});

// ============================================================================
// Tests: Event Queuing and Flushing
// ============================================================================

describe('event queuing', () => {
  it('queues events and flushes on interval', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 50,
      maxBatchSize: 100,
    });

    transport.start('session-flush');
    transport.pushEvent(makeEvent(0));
    transport.pushEvent(makeEvent(100));
    transport.pushEvent(makeEvent(200));

    // Wait for flush interval to fire
    await waitMs(150);

    expect(receivedPayloads.length).toBeGreaterThanOrEqual(1);
    const allEvents = receivedPayloads.flatMap(p => p.events);
    expect(allEvents).toHaveLength(3);

    transport.stop();
  });

  it('force-flushes when batch is full', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 10000, // Long interval — flush should be triggered by size
      maxBatchSize: 3,
    });

    transport.start('session-batch');
    transport.pushEvent(makeEvent(0));
    transport.pushEvent(makeEvent(100));
    transport.pushEvent(makeEvent(200)); // Should trigger flush at 3

    await waitMs(100);

    expect(receivedPayloads.length).toBeGreaterThanOrEqual(1);
    expect(receivedPayloads[0].events).toHaveLength(3);

    transport.stop();
  });

  it('queues rrweb events separately', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 50,
    });

    transport.start('session-rrweb');
    transport.pushEvent(makeEvent());
    transport.pushRrwebEvent({ type: 4, data: {} });
    transport.pushRrwebEvent({ type: 3, data: {} });

    await waitMs(150);

    const payload = receivedPayloads[0];
    expect(payload.events).toHaveLength(1);
    expect(payload.rrwebEvents).toHaveLength(2);

    transport.stop();
  });

  it('does not flush empty buffers', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 50,
    });

    transport.start('session-empty');
    await waitMs(150); // Multiple intervals pass with no events

    expect(receivedPayloads).toHaveLength(0);

    transport.stop();
  });
});

// ============================================================================
// Tests: Stop Flushes Remaining Events
// ============================================================================

describe('stop behavior', () => {
  it('flushes pending events on stop', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 10000, // Very long interval
    });

    transport.start('session-stop');
    transport.pushEvent(makeEvent(0));
    transport.pushEvent(makeEvent(100));
    transport.stop(); // Should trigger final flush

    await waitMs(100);

    const allEvents = receivedPayloads.flatMap(p => p.events);
    expect(allEvents).toHaveLength(2);
  });

  it('does not re-queue events after stop', async () => {
    // Make server fail so events would normally be re-queued
    shouldFail = true;

    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 10000,
      retryAttempts: 0, // No retries
      fallbackToStorage: false,
    });

    transport.start('session-no-requeue');
    transport.pushEvent(makeEvent());
    transport.stop(); // Flush fires, server fails, but sessionId is now null

    await waitMs(100);

    // Push more events after stop — should be silently dropped
    transport.pushEvent(makeEvent());

    shouldFail = false;

    // Start new session — should not include old events
    transport.start('session-fresh');
    transport.pushEvent(makeEvent(0));
    transport.stop();

    await waitMs(100);

    const freshPayloads = receivedPayloads.filter(p => p.sessionId === 'session-fresh');
    const freshEvents = freshPayloads.flatMap(p => p.events);
    expect(freshEvents).toHaveLength(1);
  });

  it('clears flush timer on stop', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 50,
    });

    transport.start('session-timer');
    transport.stop();

    // After stop, even if we wait for intervals, no flushes should happen
    const countBefore = requestCount;
    await waitMs(200);
    expect(requestCount).toBe(countBefore);
  });
});

// ============================================================================
// Tests: Retry Logic
// ============================================================================

describe('retry logic', () => {
  it('retries on server failure', async () => {
    failsRemaining = 1; // Fail first attempt, succeed on retry

    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 50,
      retryAttempts: 2,
      retryDelayMs: 10,
    });

    transport.start('session-retry');
    transport.pushEvent(makeEvent());

    await waitMs(300);

    // Should have succeeded after retry
    expect(receivedPayloads.length).toBeGreaterThanOrEqual(1);
    expect(failCount).toBe(1); // Exactly one failure before success

    transport.stop();
  });

  it('re-queues events on complete failure (when still active)', async () => {
    failsRemaining = 5; // More than retry attempts

    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 50,
      retryAttempts: 1,
      retryDelayMs: 10,
      fallbackToStorage: false,
    });

    transport.start('session-requeue');
    transport.pushEvent(makeEvent(0));

    // Wait for first flush attempt to fail
    await waitMs(200);

    // Now let server succeed
    failsRemaining = 0;

    // Wait for next flush interval to send re-queued events
    await waitMs(200);

    // Events should eventually arrive
    const allEvents = receivedPayloads.flatMap(p => p.events);
    expect(allEvents.length).toBeGreaterThanOrEqual(1);

    transport.stop();
  });
});

// ============================================================================
// Tests: Concurrent Flush Safety
// ============================================================================

describe('concurrent flush safety', () => {
  it('prevents concurrent flushes (flushing guard)', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 10000,
      retryAttempts: 0,
      retryDelayMs: 0,
    });

    transport.start('session-concurrent');
    transport.pushEvent(makeEvent(0));
    transport.pushEvent(makeEvent(100));

    // Call flush multiple times rapidly
    transport.flush();
    transport.flush(); // Should be skipped (flushing guard)
    transport.flush(); // Should be skipped (flushing guard)

    await waitMs(100);

    // Only one request should have gone through
    const sessionPayloads = receivedPayloads.filter(p => p.sessionId === 'session-concurrent');
    expect(sessionPayloads).toHaveLength(1);

    transport.stop();
  });

  it('new events during flush go to fresh buffer', async () => {
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      batchInterval: 10000,
      maxBatchSize: 2,
      retryAttempts: 0,
    });

    transport.start('session-buffer');
    transport.pushEvent(makeEvent(0));
    transport.pushEvent(makeEvent(100)); // Triggers flush (maxBatchSize=2)

    // While flush is in-flight, push more events
    transport.pushEvent(makeEvent(200));

    await waitMs(100);

    // Stop triggers final flush for the event pushed during in-flight
    transport.stop();
    await waitMs(100);

    const allEvents = receivedPayloads
      .filter(p => p.sessionId === 'session-buffer')
      .flatMap(p => p.events);
    expect(allEvents).toHaveLength(3);
  });
});

// ============================================================================
// Tests: uploadSession
// ============================================================================

describe('uploadSession', () => {
  it('uploads a complete session via POST /session', async () => {
    const transport = new StreamingTransport({ endpoint: mockUrl });

    const session = {
      header: {
        sessionId: 'upload-test',
        startTime: Date.now(),
        device: { platform: 'web' as const, osVersion: '14', screen: { width: 1920, height: 1080, pixelRatio: 2 } },
        app: { name: 'Test', version: '1.0', identifier: 'com.test' },
        schemaVersion: 1,
      },
      elements: [],
      events: [{ dt: 0, type: 0, data: {} }],
      screenshots: [],
    } as any;

    const result = await transport.uploadSession(session);
    expect(result).toBe(true);
    expect(receivedPayloads.length).toBe(1);
  });

  it('returns false on server error', async () => {
    shouldFail = true;
    const transport = new StreamingTransport({
      endpoint: mockUrl,
      fallbackToStorage: false,
    });

    const session = {
      header: { sessionId: 'upload-fail', startTime: Date.now(), device: { platform: 'web', osVersion: '14', screen: { width: 1, height: 1, pixelRatio: 1 } }, app: { name: 'T', version: '1', identifier: 'x' }, schemaVersion: 1 },
      elements: [], events: [], screenshots: [],
    } as any;

    const result = await transport.uploadSession(session);
    expect(result).toBe(false);
  });

  it('returns false when server is unreachable', async () => {
    const transport = new StreamingTransport({
      endpoint: 'http://localhost:1', // Nothing listening
      fallbackToStorage: false,
    });

    const session = {
      header: { sessionId: 'unreachable', startTime: Date.now(), device: { platform: 'web', osVersion: '14', screen: { width: 1, height: 1, pixelRatio: 1 } }, app: { name: 'T', version: '1', identifier: 'x' }, schemaVersion: 1 },
      elements: [], events: [], screenshots: [],
    } as any;

    const result = await transport.uploadSession(session);
    expect(result).toBe(false);
  });
});

