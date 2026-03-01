import { describe, test, expect, beforeEach } from 'bun:test';
import {
  PostHogImporter,
  createPostHogImporter,
  importRecording,
  type PostHogConfig,
  type PostHogRecording,
  type RecordingMetadata,
} from './posthog.ts';
import { EventTypeEnum } from '@gremlin/session';
import { RrwebEventType, IncrementalSource, MouseInteractions } from './rrweb-types.ts';

// ============================================================================
// Helpers
// ============================================================================

const testConfig: PostHogConfig = {
  apiKey: 'phx_test_key',
  projectId: '12345',
  baseUrl: 'https://posthog.test',
};

function makeRecording(
  overrides: Partial<PostHogRecording> = {}
): PostHogRecording {
  return {
    id: 'rec-001',
    distinct_id: 'user-abc',
    viewed: false,
    recording_duration: 30,
    start_time: '2025-01-15T10:00:00.000Z',
    end_time: '2025-01-15T10:00:30.000Z',
    snapshot_data: [],
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// createPostHogImporter factory
// ============================================================================

describe('createPostHogImporter', () => {
  test('returns a PostHogImporter instance', () => {
    const importer = createPostHogImporter(testConfig);
    expect(importer).toBeInstanceOf(PostHogImporter);
  });

  test('defaults baseUrl to PostHog cloud', () => {
    const importer = createPostHogImporter({
      apiKey: 'phx_key',
      projectId: '1',
    });
    expect(importer).toBeInstanceOf(PostHogImporter);
  });
});

// ============================================================================
// convertToGremlinSession
// ============================================================================

describe('PostHogImporter.convertToGremlinSession', () => {
  let importer: PostHogImporter;

  beforeEach(() => {
    importer = new PostHogImporter(testConfig);
  });

  test('converts a basic recording with meta event', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: {
            href: 'https://app.example.com/dashboard',
            width: 1440,
            height: 900,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.header.sessionId).toBe('rec-001');
    expect(session.header.schemaVersion).toBe(1);
    expect(session.header.device.platform).toBe('web');
    expect(session.header.device.screen.width).toBe(1440);
    expect(session.header.device.screen.height).toBe(900);
    expect(session.header.app.name).toBe('app.example.com');
    expect(session.header.app.identifier).toBe('https://app.example.com');
  });

  test('produces navigation event from Meta rrweb event', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: {
            href: 'https://example.com/page',
            width: 1920,
            height: 1080,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.events.length).toBe(1);
    expect(session.events[0].type).toBe(EventTypeEnum.NAVIGATION);
    expect(session.events[0].data).toMatchObject({
      kind: 'navigation',
      navType: 'push',
      screen: 'https://example.com/page',
      url: 'https://example.com/page',
    });
  });

  test('converts click events to TAP', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: {
              type: 1,
              id: 10,
              tagName: 'button',
              attributes: { 'data-testid': 'save-btn', class: 'primary' },
            },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 10,
            x: 150,
            y: 250,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // Navigation + Click
    expect(session.events.length).toBe(2);

    const tapEvent = session.events[1];
    expect(tapEvent.type).toBe(EventTypeEnum.TAP);
    expect(tapEvent.data).toMatchObject({
      kind: 'tap',
      x: 150,
      y: 250,
      elementIndex: 0,
    });

    // Element should be registered
    expect(session.elements.length).toBe(1);
    expect(session.elements[0].testId).toBe('save-btn');
    expect(session.elements[0].type).toBe('button');
    expect(session.elements[0].cssSelector).toBe('button.primary');
  });

  test('converts double-click events to DOUBLE_TAP', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: { type: 1, id: 5, tagName: 'div', attributes: {} },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.DblClick,
            id: 5,
            x: 300,
            y: 400,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    const dblClick = session.events[1];
    expect(dblClick.type).toBe(EventTypeEnum.DOUBLE_TAP);
    expect(dblClick.data).toMatchObject({
      kind: 'double_tap',
      x: 300,
      y: 400,
    });
  });

  test('converts MouseUp events to TAP', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: { type: 1, id: 7, tagName: 'a', attributes: {} },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.MouseUp,
            id: 7,
            x: 50,
            y: 60,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    const tapEvt = session.events[1];
    expect(tapEvt.type).toBe(EventTypeEnum.TAP);
    expect(tapEvt.data).toMatchObject({ kind: 'tap', x: 50, y: 60 });
  });

  test('converts scroll events with delta computation', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: { type: 1, id: 20, tagName: 'div', attributes: { class: 'scroll-container' } },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.Scroll,
            scrollData: { id: 20, x: 0, y: 300 },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 3000,
          data: {
            source: IncrementalSource.Scroll,
            scrollData: { id: 20, x: 0, y: 800 },
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // Navigation + 2 scroll events
    expect(session.events.length).toBe(3);

    // First scroll: delta from 0,0 to 0,300
    expect(session.events[1].type).toBe(EventTypeEnum.SCROLL);
    expect(session.events[1].data).toMatchObject({
      kind: 'scroll',
      deltaX: 0,
      deltaY: 300,
    });

    // Second scroll: delta from 0,300 to 0,800
    expect(session.events[2].type).toBe(EventTypeEnum.SCROLL);
    expect(session.events[2].data).toMatchObject({
      kind: 'scroll',
      deltaX: 0,
      deltaY: 500,
    });
  });

  test('converts input events', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: {
              type: 1,
              id: 15,
              tagName: 'input',
              attributes: { type: 'email' },
            },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.Input,
            id: 15,
            text: 'user@example.com',
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.events.length).toBe(2);

    const inputEvt = session.events[1];
    expect(inputEvt.type).toBe(EventTypeEnum.INPUT);
    expect(inputEvt.data).toMatchObject({
      kind: 'input',
      value: 'user@example.com',
      masked: false,
      elementIndex: 0,
    });
  });

  test('converts console error log events', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.Log,
            payload: {
              level: 'error',
              payload: ['TypeError:', 'undefined is not a function'],
            },
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.events.length).toBe(2);

    const errorEvt = session.events[1];
    expect(errorEvt.type).toBe(EventTypeEnum.ERROR);
    expect(errorEvt.data).toMatchObject({
      kind: 'error',
      message: 'TypeError: undefined is not a function',
      errorType: 'js',
      fatal: false,
    });
  });

  test('ignores non-error console log events', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.Log,
            payload: {
              level: 'info',
              payload: ['page loaded'],
            },
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // Only the navigation event from meta, no error
    expect(session.events.length).toBe(1);
    expect(session.events[0].type).toBe(EventTypeEnum.NAVIGATION);
  });

  test('computes dt (delta time) between events', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: { type: 1, id: 1, tagName: 'button', attributes: {} },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 3000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 1,
            x: 10,
            y: 20,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // First event dt is relative to first rrweb event timestamp (0 for first event)
    expect(session.events[0].dt).toBe(0);

    // Second event dt is relative to first event timestamp
    expect(session.events[1].dt).toBe(2000); // 3000 - 1000
  });

  test('handles empty snapshot_data', () => {
    const recording = makeRecording({ snapshot_data: [] });

    const session = importer.convertToGremlinSession(recording);

    expect(session.header.sessionId).toBe('rec-001');
    expect(session.events).toEqual([]);
    expect(session.elements).toEqual([]);
    expect(session.screenshots).toEqual([]);
  });

  test('handles recording with no interaction events (only meta)', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 5000,
          data: { href: 'https://example.com', width: 800, height: 600 },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.events.length).toBe(1);
    expect(session.events[0].type).toBe(EventTypeEnum.NAVIGATION);
    expect(session.elements).toEqual([]);
  });

  test('uses default screen dimensions when no meta event exists', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1000,
          data: {
            node: { type: 1, id: 1, tagName: 'div', attributes: {} },
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.header.device.screen.width).toBe(1920);
    expect(session.header.device.screen.height).toBe(1080);
    expect(session.header.app.name).toBe('unknown');
  });

  test('deduplicates elements by matching fields', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: {
              type: 1,
              id: 42,
              tagName: 'button',
              attributes: { 'data-testid': 'ok-btn' },
            },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 42,
            x: 10,
            y: 20,
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 3000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 42,
            x: 12,
            y: 22,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // Same element clicked twice, should only appear once
    expect(session.elements.length).toBe(1);
    expect(session.events[1].data).toMatchObject({ elementIndex: 0 });
    expect(session.events[2].data).toMatchObject({ elementIndex: 0 });
  });

  test('builds node map from full snapshot with child nodes', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: {
              type: 1,
              id: 1,
              tagName: 'div',
              attributes: {},
              childNodes: [
                {
                  type: 1,
                  id: 2,
                  tagName: 'a',
                  attributes: { 'data-testid': 'link-1' },
                  textContent: 'Click me',
                },
              ],
            },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 2,
            x: 50,
            y: 60,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // Child node should be found via the node map
    expect(session.elements.length).toBe(1);
    expect(session.elements[0].testId).toBe('link-1');
    expect(session.elements[0].type).toBe('link');
    expect(session.elements[0].text).toBe('Click me');
  });

  test('extracts person browser as userAgent', () => {
    const recording = makeRecording({
      person: {
        id: 'person-1',
        name: 'Test User',
        properties: {
          $browser: 'Chrome',
          $locale: 'en-US',
        },
      },
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    expect(session.header.device.userAgent).toBe('Chrome');
    expect(session.header.device.locale).toBe('en-US');
  });

  test('sorts snapshot_data by timestamp before processing', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 3000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 1,
            x: 10,
            y: 20,
          },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: { type: 1, id: 1, tagName: 'button', attributes: {} },
          },
        },
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // Should still produce correct results despite out-of-order input
    expect(session.events[0].type).toBe(EventTypeEnum.NAVIGATION);
    expect(session.events[1].type).toBe(EventTypeEnum.TAP);
    expect(session.elements.length).toBe(1);
  });

  test('CSS selector includes id and classes', () => {
    const recording = makeRecording({
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
        {
          type: RrwebEventType.FullSnapshot,
          timestamp: 1010,
          data: {
            node: {
              type: 1,
              id: 8,
              tagName: 'button',
              attributes: { id: 'main-btn', class: 'btn lg primary' },
            },
          },
        },
        {
          type: RrwebEventType.IncrementalSnapshot,
          timestamp: 2000,
          data: {
            source: IncrementalSource.MouseInteraction,
            type: MouseInteractions.Click,
            id: 8,
            x: 10,
            y: 20,
          },
        },
      ],
    });

    const session = importer.convertToGremlinSession(recording);

    // When an ID is present, it's the most specific selector — classes are redundant
    expect(session.elements[0].cssSelector).toBe('button#main-btn');
  });
});

// ============================================================================
// Network API methods (mocked fetch)
// ============================================================================

describe('PostHogImporter API methods', () => {
  const originalFetch = globalThis.fetch;

  function mockFetch(fn: (...args: unknown[]) => Promise<Response>): void {
    globalThis.fetch = fn as typeof fetch;
  }

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listRecordings sends correct request and returns results', async () => {
    const listResponse = {
      results: [
        { id: 'rec-1', distinct_id: 'u1', viewed: false, recording_duration: 20, start_time: '2025-01-01T00:00:00Z', end_time: '2025-01-01T00:00:20Z' },
      ],
      next: null,
      total_count: 1,
    };

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    mockFetch(async (input: unknown, init?: unknown) => {
      capturedUrl = String(input);
      capturedHeaders = ((init as RequestInit)?.headers as Record<string, string>) ?? {};
      return mockFetchResponse(listResponse);
    });

    const importer = new PostHogImporter(testConfig);
    const result = await importer.listRecordings({ limit: 10 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('rec-1');
    expect(capturedUrl).toContain('/api/projects/12345/session_recordings/');
    expect(capturedUrl).toContain('limit=10');
    expect(capturedHeaders['Authorization']).toBe('Bearer phx_test_key');
  });

  test('listRecordings builds query params correctly', async () => {
    let capturedUrl = '';
    mockFetch(async (input: unknown) => {
      capturedUrl = String(input);
      return mockFetchResponse({ results: [] });
    });

    const importer = new PostHogImporter(testConfig);
    await importer.listRecordings({
      limit: 5,
      offset: 10,
      dateFrom: new Date('2025-01-01'),
      durationMin: 60,
      personId: 'person-xyz',
    });

    expect(capturedUrl).toContain('limit=5');
    expect(capturedUrl).toContain('offset=10');
    expect(capturedUrl).toContain('date_from=');
    expect(capturedUrl).toContain('duration_min=60');
    expect(capturedUrl).toContain('person_id=person-xyz');
  });

  test('listRecordings throws on non-ok response', async () => {
    mockFetch(async () => mockFetchResponse({}, false, 401));

    const importer = new PostHogImporter(testConfig);

    await expect(importer.listRecordings()).rejects.toThrow(
      'Failed to list recordings: 401'
    );
  });

  test('fetchRecording returns recording with snapshot data', async () => {
    const recordingData = makeRecording({
      id: 'rec-fetch',
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 1920, height: 1080 },
        },
      ],
    });

    mockFetch(async () => mockFetchResponse(recordingData));

    const importer = new PostHogImporter(testConfig);
    const result = await importer.fetchRecording('rec-fetch');

    expect(result.id).toBe('rec-fetch');
    expect(result.snapshot_data).toHaveLength(1);
  });

  test('fetchRecording fetches snapshots separately when missing', async () => {
    const calls: string[] = [];

    mockFetch(async (input: unknown) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith('/snapshots')) {
        return mockFetchResponse({
          snapshot_data: [
            {
              type: RrwebEventType.Meta,
              timestamp: 1000,
              data: { href: 'https://example.com', width: 1920, height: 1080 },
            },
          ],
        });
      }

      // Recording without snapshot_data
      return mockFetchResponse({
        id: 'rec-no-snap',
        distinct_id: 'u1',
        viewed: false,
        recording_duration: 10,
        start_time: '2025-01-01T00:00:00Z',
        end_time: '2025-01-01T00:00:10Z',
      });
    });

    const importer = new PostHogImporter(testConfig);
    const result = await importer.fetchRecording('rec-no-snap');

    expect(calls.length).toBe(2);
    expect(calls[1]).toContain('/snapshots');
    expect(result.snapshot_data).toHaveLength(1);
  });

  test('fetchRecording throws on non-ok response', async () => {
    mockFetch(async () => mockFetchResponse({}, false, 404));

    const importer = new PostHogImporter(testConfig);

    await expect(importer.fetchRecording('bad-id')).rejects.toThrow(
      'Failed to fetch recording: 404'
    );
  });

  test('fetchRecording returns empty snapshots on snapshot fetch failure', async () => {
    let callCount = 0;

    mockFetch(async () => {
      callCount++;
      if (callCount === 1) {
        // Main recording without snapshot_data
        return mockFetchResponse({
          id: 'rec-snap-fail',
          distinct_id: 'u1',
          viewed: false,
          recording_duration: 10,
          start_time: '2025-01-01T00:00:00Z',
          end_time: '2025-01-01T00:00:10Z',
        });
      }
      // Snapshot fetch fails
      return mockFetchResponse({}, false, 500);
    });

    const importer = new PostHogImporter(testConfig);
    const result = await importer.fetchRecording('rec-snap-fail');

    expect(result.snapshot_data).toEqual([]);
  });
});

// ============================================================================
// importRecording convenience function
// ============================================================================

describe('importRecording', () => {
  test('fetches and converts a recording end-to-end', async () => {
    const originalFetch = globalThis.fetch;
    const recordingData = makeRecording({
      id: 'rec-e2e',
      snapshot_data: [
        {
          type: RrwebEventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com/test', width: 1024, height: 768 },
        },
      ],
    });

    globalThis.fetch = (async () => mockFetchResponse(recordingData)) as unknown as typeof fetch;

    const session = await importRecording(testConfig, 'rec-e2e');

    expect(session.header.sessionId).toBe('rec-e2e');
    expect(session.header.app.name).toBe('example.com');
    expect(session.events.length).toBe(1);
    expect(session.events[0].type).toBe(EventTypeEnum.NAVIGATION);

    globalThis.fetch = originalFetch;
  });
});
