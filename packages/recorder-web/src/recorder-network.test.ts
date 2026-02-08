import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventTypeEnum } from '@gremlin/session';
import type { NetworkEvent } from '@gremlin/session';

// ============================================================================
// Mock rrweb before importing recorder
// ============================================================================

// We must mock rrweb since it requires a real DOM
mock.module('rrweb', () => ({
  record: () => () => {}, // returns a stop function
}));

// Mock web-vitals (not available in test env)
mock.module('web-vitals', () => ({
  onLCP: () => {},
  onCLS: () => {},
  onINP: () => {},
  onFCP: () => {},
  onTTFB: () => {},
}));

import { GremlinRecorder, type RecorderConfig } from './recorder';

// ============================================================================
// Browser Global Mocks
// ============================================================================

// Save originals
const origFetch = globalThis.fetch;
const origXHR = globalThis.XMLHttpRequest;
const origWindow = globalThis.window;
const origDocument = globalThis.document;
const origNavigator = globalThis.navigator;
const origHistory = globalThis.history;
const origScreen = (globalThis as any).screen;
const origSessionStorage = globalThis.sessionStorage;
const origPerformance = globalThis.performance;
const origRAF = globalThis.requestAnimationFrame;
const origCAF = globalThis.cancelAnimationFrame;
const origSetInterval = globalThis.setInterval;
const origClearInterval = globalThis.clearInterval;
const origPerfObserver = (globalThis as any).PerformanceObserver;

/** Event listeners tracked by mock document/window */
type ListenerMap = Map<string, Set<Function>>;

function createMockEventTarget(): { listeners: ListenerMap; addEventListener: Function; removeEventListener: Function } {
  const listeners: ListenerMap = new Map();
  return {
    listeners,
    addEventListener(event: string, handler: Function, _capture?: boolean) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeEventListener(event: string, handler: Function, _capture?: boolean) {
      listeners.get(event)?.delete(handler);
    },
  };
}

/** XHR mock that supports event listeners */
class MockXMLHttpRequest {
  static readonly DONE = 4;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly OPENED = 1;
  static readonly UNSENT = 0;

  readyState = 0;
  status = 0;
  responseText = '';
  response: any = null;
  private _listeners: Map<string, Set<Function>> = new Map();

  // These will be monkey-patched by the recorder
  open(method: string, url: string | URL, ...rest: any[]) {
    // default no-op; recorder overrides via prototype
  }
  send(body?: any) {
    // default no-op; recorder overrides via prototype
  }

  addEventListener(event: string, handler: Function) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: Function) {
    this._listeners.get(event)?.delete(handler);
  }

  /** Simulate successful completion */
  _simulateLoad(status: number) {
    this.status = status;
    this.readyState = 4;
    for (const fn of this._listeners.get('load') ?? []) fn();
  }

  /** Simulate network error */
  _simulateError() {
    for (const fn of this._listeners.get('error') ?? []) fn();
  }

  /** Simulate abort */
  _simulateAbort() {
    for (const fn of this._listeners.get('abort') ?? []) fn();
  }
}

function installBrowserGlobals() {
  const docTarget = createMockEventTarget();
  const winTarget = createMockEventTarget();

  // Mock fetch that resolves immediately
  let mockFetchImpl = async (input: any, init?: any): Promise<Response> => {
    return new Response('ok', { status: 200 });
  };

  const mockFetch: any = (input: any, init?: any) => mockFetchImpl(input, init);
  mockFetch.preconnect = () => {};

  // Mock document
  const mockDocument: any = {
    ...docTarget,
    readyState: 'complete',
    title: 'Test Page',
    body: {},
    documentElement: {},
    visibilityState: 'visible',
    getElementById: () => null,
    querySelector: () => null,
  };

  // Mock window
  const mockWindow: any = {
    ...winTarget,
    location: {
      origin: 'https://myapp.com',
      href: 'https://myapp.com/page',
      pathname: '/page',
    },
    fetch: mockFetch,
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 2,
    scrollY: 0,
    scrollX: 0,
    setInterval: origSetInterval,
    clearInterval: origClearInterval,
  };

  // Mock navigator
  const mockNavigator: any = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Test',
    language: 'en-US',
  };

  // Mock history
  const mockHistory: any = {
    pushState: (..._args: any[]) => {},
    replaceState: (..._args: any[]) => {},
  };

  // Mock sessionStorage
  const storageData: Record<string, string> = {};
  const mockSessionStorage: any = {
    getItem: (key: string) => storageData[key] ?? null,
    setItem: (key: string, value: string) => { storageData[key] = value; },
    removeItem: (key: string) => { delete storageData[key]; },
  };

  // Mock performance
  const mockPerformance: any = {
    now: () => Date.now(),
    memory: { usedJSHeapSize: 50 * 1024 * 1024 },
  };

  // Mock PerformanceObserver
  (globalThis as any).PerformanceObserver = class {
    constructor(_cb: any) {}
    observe() {}
    disconnect() {}
  };

  // Assign globals
  (globalThis as any).window = mockWindow;
  (globalThis as any).document = mockDocument;
  (globalThis as any).navigator = mockNavigator;
  (globalThis as any).history = mockHistory;
  (globalThis as any).screen = mockWindow.screen;
  (globalThis as any).sessionStorage = mockSessionStorage;
  (globalThis as any).fetch = mockFetch;
  (globalThis as any).XMLHttpRequest = MockXMLHttpRequest;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => 1;
  (globalThis as any).cancelAnimationFrame = () => {};

  // Also set on window object so recorder accesses work
  mockWindow.fetch = mockFetch;
  mockWindow.XMLHttpRequest = MockXMLHttpRequest;

  // CSS.escape used by element-capture
  (globalThis as any).CSS = { escape: (s: string) => s };

  return {
    mockWindow,
    mockDocument,
    mockHistory,
    mockFetch,
    setFetchImpl(impl: (input: any, init?: any) => Promise<Response>) {
      mockFetchImpl = impl;
    },
    storageData,
  };
}

function restoreBrowserGlobals() {
  (globalThis as any).fetch = origFetch;
  (globalThis as any).XMLHttpRequest = origXHR;
  (globalThis as any).window = origWindow;
  (globalThis as any).document = origDocument;
  (globalThis as any).navigator = origNavigator;
  (globalThis as any).history = origHistory;
  (globalThis as any).screen = origScreen;
  (globalThis as any).sessionStorage = origSessionStorage;
  (globalThis as any).requestAnimationFrame = origRAF;
  (globalThis as any).cancelAnimationFrame = origCAF;
  (globalThis as any).PerformanceObserver = origPerfObserver;
}

// ============================================================================
// Helpers
// ============================================================================

function createRecorder(overrides: Partial<RecorderConfig> = {}): GremlinRecorder {
  return new GremlinRecorder({
    appName: 'TestApp',
    appVersion: '1.0.0',
    capturePerformance: false,
    captureRrweb: false,
    transport: false,
    autoStart: false,
    persistSession: false,
    ...overrides,
  });
}

function getNetworkEvents(recorder: GremlinRecorder): NetworkEvent[] {
  const session = recorder.getSession();
  if (!session) return [];
  return session.events
    .filter((e) => e.type === EventTypeEnum.NETWORK)
    .map((e) => e.data as NetworkEvent);
}

// ============================================================================
// Tests
// ============================================================================

describe('GremlinRecorder Network Interception', () => {
  let env: ReturnType<typeof installBrowserGlobals>;

  beforeEach(() => {
    env = installBrowserGlobals();
  });

  afterEach(() => {
    restoreBrowserGlobals();
  });

  // --------------------------------------------------------------------------
  // Fetch interception
  // --------------------------------------------------------------------------

  describe('fetch interception', () => {
    test('replaces window.fetch after start()', () => {
      const recorder = createRecorder();
      const beforeFetch = window.fetch;
      recorder.start();
      expect(window.fetch).not.toBe(beforeFetch);
      recorder.stop();
    });

    test('records NetworkEvent with phase=start then phase=end on successful fetch', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('https://api.example.com/users?token=secret');

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(2);

      const startEvt = events[0];
      expect(startEvt.phase).toBe('start');
      expect(startEvt.method).toBe('GET');
      expect(startEvt.requestId).toBe('net_1');

      const endEvt = events[1];
      expect(endEvt.phase).toBe('end');
      expect(endEvt.status).toBe(200);
      expect(endEvt.requestId).toBe('net_1');
      expect(typeof endEvt.duration).toBe('number');

      recorder.stop();
    });

    test('records phase=error on fetch failure', async () => {
      env.setFetchImpl(async () => {
        throw new Error('Network failure');
      });

      const recorder = createRecorder();
      recorder.start();

      try {
        await window.fetch('https://api.example.com/data');
      } catch {
        // expected
      }

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(2);

      const errorEvt = events[1];
      expect(errorEvt.phase).toBe('error');
      expect(errorEvt.error).toBe('Network failure');

      recorder.stop();
    });

    test('preserves fetch method from init', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('https://api.example.com/users', { method: 'POST' });

      const events = getNetworkEvents(recorder);
      expect(events[0].method).toBe('POST');
      expect(events[1].method).toBe('POST');

      recorder.stop();
    });

    test('defaults to GET when no method specified', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('https://api.example.com/data');

      const events = getNetworkEvents(recorder);
      expect(events[0].method).toBe('GET');

      recorder.stop();
    });

    test('increments requestId for each fetch call', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('https://api.example.com/a');
      await window.fetch('https://api.example.com/b');

      const events = getNetworkEvents(recorder);
      // First fetch: net_1
      expect(events[0].requestId).toBe('net_1');
      expect(events[1].requestId).toBe('net_1');
      // Second fetch: net_2
      expect(events[2].requestId).toBe('net_2');
      expect(events[3].requestId).toBe('net_2');

      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // URL sanitization
  // --------------------------------------------------------------------------

  describe('URL sanitization', () => {
    test('strips query parameters from URLs (privacy)', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('https://api.example.com/users?token=abc&page=1');

      const events = getNetworkEvents(recorder);
      expect(events[0].url).toBe('https://api.example.com/users');
      expect(events[0].url).not.toContain('token');
      expect(events[0].url).not.toContain('page');

      recorder.stop();
    });

    test('strips hash from URLs', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('https://api.example.com/page#section');

      const events = getNetworkEvents(recorder);
      // origin + pathname, no hash
      expect(events[0].url).toBe('https://api.example.com/page');

      recorder.stop();
    });

    test('resolves relative URLs against window.location.origin', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('/api/data?key=secret');

      const events = getNetworkEvents(recorder);
      expect(events[0].url).toBe('https://myapp.com/api/data');

      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Self-filtering (gremlin dev server)
  // --------------------------------------------------------------------------

  describe('self-filtering', () => {
    test('does NOT record requests to localhost:3334 (gremlin dev server)', async () => {
      const recorder = createRecorder();
      recorder.start();

      await window.fetch('http://localhost:3334/api/sessions');

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(0);

      recorder.stop();
    });

    test('does NOT record requests to data: URLs', async () => {
      const recorder = createRecorder();
      recorder.start();

      // data: URLs get filtered by shouldIgnoreUrl
      try {
        await window.fetch('data:text/plain,hello');
      } catch {
        // might fail in mock, that's fine
      }

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(0);

      recorder.stop();
    });

    test('does NOT record requests to blob: URLs', async () => {
      const recorder = createRecorder();
      recorder.start();

      try {
        await window.fetch('blob:https://example.com/12345');
      } catch {
        // might fail in mock
      }

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(0);

      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Ignore patterns
  // --------------------------------------------------------------------------

  describe('networkIgnorePatterns', () => {
    test('ignores URLs matching ignore patterns', async () => {
      const recorder = createRecorder({
        networkIgnorePatterns: ['analytics.example.com', '/health'],
      });
      recorder.start();

      await window.fetch('https://analytics.example.com/track');
      await window.fetch('https://myapp.com/health');
      await window.fetch('https://api.example.com/users');

      const events = getNetworkEvents(recorder);
      // Only the last fetch should be recorded
      expect(events.length).toBe(2); // start + end for /users
      expect(events[0].url).toBe('https://api.example.com/users');

      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Restore on stop
  // --------------------------------------------------------------------------

  describe('restore on stop', () => {
    test('restores original fetch after stop()', () => {
      const recorder = createRecorder();
      const originalFetch = window.fetch;

      recorder.start();
      // fetch is now wrapped
      expect(window.fetch).not.toBe(originalFetch);

      recorder.stop();
      // fetch should be restored
      expect(window.fetch).toBe(originalFetch);
    });

    test('restores XHR prototypes after stop()', () => {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      const recorder = createRecorder();
      recorder.start();

      // XHR prototypes should be replaced
      expect(XMLHttpRequest.prototype.open).not.toBe(origOpen);
      expect(XMLHttpRequest.prototype.send).not.toBe(origSend);

      recorder.stop();

      // Should be restored
      expect(XMLHttpRequest.prototype.open).toBe(origOpen);
      expect(XMLHttpRequest.prototype.send).toBe(origSend);
    });
  });

  // --------------------------------------------------------------------------
  // captureNetwork: false
  // --------------------------------------------------------------------------

  describe('captureNetwork: false', () => {
    test('does not intercept fetch when captureNetwork is false', async () => {
      const originalFetch = window.fetch;

      const recorder = createRecorder({ captureNetwork: false });
      recorder.start();

      // fetch should NOT be replaced
      expect(window.fetch).toBe(originalFetch);

      await window.fetch('https://api.example.com/data');

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(0);

      recorder.stop();
    });

    test('does not intercept XHR when captureNetwork is false', () => {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      const recorder = createRecorder({ captureNetwork: false });
      recorder.start();

      // XHR should NOT be replaced
      expect(XMLHttpRequest.prototype.open).toBe(origOpen);
      expect(XMLHttpRequest.prototype.send).toBe(origSend);

      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // XHR interception
  // --------------------------------------------------------------------------

  describe('XHR interception', () => {
    test('intercepts XHR open and send to record network events', () => {
      const recorder = createRecorder();
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://api.example.com/items');
      xhr.send();

      // Simulate successful load
      (xhr as any)._simulateLoad(200);

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(2);

      expect(events[0].phase).toBe('start');
      expect(events[0].method).toBe('GET');
      expect(events[0].url).toBe('https://api.example.com/items');

      expect(events[1].phase).toBe('end');
      expect(events[1].status).toBe(200);

      recorder.stop();
    });

    test('records XHR error event', () => {
      const recorder = createRecorder();
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api.example.com/submit');
      xhr.send('data');

      (xhr as any)._simulateError();

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(2);

      expect(events[1].phase).toBe('error');
      expect(events[1].error).toBe('Network request failed');

      recorder.stop();
    });

    test('records XHR abort event', () => {
      const recorder = createRecorder();
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://api.example.com/slow');
      xhr.send();

      (xhr as any)._simulateAbort();

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(2);

      expect(events[1].phase).toBe('error');
      expect(events[1].error).toBe('Request aborted');

      recorder.stop();
    });

    test('XHR sanitizes URL (strips query params)', () => {
      const recorder = createRecorder();
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://api.example.com/search?q=secret&page=1');
      xhr.send();
      (xhr as any)._simulateLoad(200);

      const events = getNetworkEvents(recorder);
      expect(events[0].url).toBe('https://api.example.com/search');
      expect(events[0].url).not.toContain('secret');

      recorder.stop();
    });

    test('XHR ignores requests to gremlin dev server', () => {
      const recorder = createRecorder();
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'http://localhost:3334/api/events');
      xhr.send();
      // Don't simulate load — it shouldn't even be tracked
      // But calling _simulateLoad would be harmless since no listeners were added

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(0);

      recorder.stop();
    });

    test('XHR respects networkIgnorePatterns', () => {
      const recorder = createRecorder({
        networkIgnorePatterns: ['tracking.example.com'],
      });
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://tracking.example.com/pixel');
      xhr.send();

      const events = getNetworkEvents(recorder);
      expect(events.length).toBe(0);

      recorder.stop();
    });

    test('XHR uppercases the method', () => {
      const recorder = createRecorder();
      recorder.start();

      const xhr = new XMLHttpRequest();
      xhr.open('post', 'https://api.example.com/data');
      xhr.send();
      (xhr as any)._simulateLoad(201);

      const events = getNetworkEvents(recorder);
      expect(events[0].method).toBe('POST');
      expect(events[1].method).toBe('POST');

      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Recorder lifecycle
  // --------------------------------------------------------------------------

  describe('recorder lifecycle', () => {
    test('start() creates a session', () => {
      const recorder = createRecorder();
      expect(recorder.getSession()).toBeNull();

      recorder.start();
      const session = recorder.getSession();
      expect(session).not.toBeNull();
      expect(session!.header.sessionId).toBeTruthy();
      expect(session!.header.app.name).toBe('TestApp');
      expect(session!.header.device.platform).toBe('web');

      recorder.stop();
    });

    test('stop() returns completed session', () => {
      const recorder = createRecorder();
      recorder.start();
      const session = recorder.stop();

      expect(session).not.toBeNull();
      expect(session!.header.endTime).toBeDefined();
      expect(session!.header.endTime!).toBeGreaterThanOrEqual(session!.header.startTime);
    });

    test('isActive() reflects recording state', () => {
      const recorder = createRecorder();
      expect(recorder.isActive()).toBe(false);

      recorder.start();
      expect(recorder.isActive()).toBe(true);

      recorder.stop();
      expect(recorder.isActive()).toBe(false);
    });

    test('double start() does not reset session', () => {
      const recorder = createRecorder();
      recorder.start();
      const sessionId = recorder.getSession()!.header.sessionId;

      recorder.start(); // second call should warn and no-op
      expect(recorder.getSession()!.header.sessionId).toBe(sessionId);

      recorder.stop();
    });

    test('stop() when not recording returns null', () => {
      const recorder = createRecorder();
      const result = recorder.stop();
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Device & App info
  // --------------------------------------------------------------------------

  describe('device and app info', () => {
    test('captures device info in session header', () => {
      const recorder = createRecorder();
      recorder.start();
      const session = recorder.getSession()!;

      expect(session.header.device.platform).toBe('web');
      expect(session.header.device.screen.width).toBe(1920);
      expect(session.header.device.screen.height).toBe(1080);
      expect(session.header.device.screen.pixelRatio).toBe(2);
      expect(session.header.device.userAgent).toContain('Test');
      expect(session.header.device.locale).toBe('en-US');

      recorder.stop();
    });

    test('captures app info in session header', () => {
      const recorder = createRecorder({ appName: 'MyApp', appVersion: '2.0.0' });
      recorder.start();
      const session = recorder.getSession()!;

      expect(session.header.app.name).toBe('MyApp');
      expect(session.header.app.version).toBe('2.0.0');
      expect(session.header.app.identifier).toBe('https://myapp.com');

      recorder.stop();
    });

    test('defaults appVersion to 0.0.1 if not provided', () => {
      const recorder = createRecorder({ appVersion: undefined });
      recorder.start();
      const session = recorder.getSession()!;
      expect(session.header.app.version).toBe('0.0.1');
      recorder.stop();
    });
  });

  // --------------------------------------------------------------------------
  // OS version detection
  // --------------------------------------------------------------------------

  describe('OS version detection', () => {
    test('detects macOS from user agent', () => {
      (globalThis as any).navigator = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        language: 'en-US',
      };

      const recorder = createRecorder();
      recorder.start();
      const session = recorder.getSession()!;
      expect(session.header.device.osVersion).toBe('macOS 10.15.7');
      recorder.stop();
    });

    test('detects Windows 10 from user agent', () => {
      (globalThis as any).navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        language: 'en-US',
      };

      const recorder = createRecorder();
      recorder.start();
      const session = recorder.getSession()!;
      expect(session.header.device.osVersion).toBe('Windows 10');
      recorder.stop();
    });

    test('detects Linux from user agent', () => {
      (globalThis as any).navigator = {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        language: 'en-US',
      };

      const recorder = createRecorder();
      recorder.start();
      const session = recorder.getSession()!;
      expect(session.header.device.osVersion).toBe('Linux');
      recorder.stop();
    });

    test('returns Unknown for unrecognized user agent', () => {
      (globalThis as any).navigator = {
        userAgent: 'SomeBot/1.0',
        language: 'en-US',
      };

      const recorder = createRecorder();
      recorder.start();
      const session = recorder.getSession()!;
      expect(session.header.device.osVersion).toBe('Unknown');
      recorder.stop();
    });
  });
});
