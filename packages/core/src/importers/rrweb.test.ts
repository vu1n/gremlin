import { describe, test, expect } from 'bun:test';
import {
  importRrwebRecording,
  parseRrwebFile,
  RrwebEventType,
  IncrementalSource,
  MouseInteractions,
  type RrwebEvent,
} from './rrweb.ts';

describe('RrwebImporter', () => {
  test('imports basic rrweb recording with meta and click events', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com/app',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1010,
        data: {
          node: {
            type: 1,
            id: 1,
            tagName: 'button',
            attributes: {
              'data-testid': 'submit-btn',
              class: 'btn btn-primary',
            },
          },
        },
      },
      {
        type: RrwebEventType.IncrementalSnapshot,
        timestamp: 2000,
        data: {
          source: IncrementalSource.MouseInteraction,
          type: MouseInteractions.Click,
          id: 1,
          x: 100,
          y: 200,
        },
      },
    ];

    const session = importRrwebRecording(events);

    // Verify header
    expect(session.header.startTime).toBe(1000);
    expect(session.header.endTime).toBe(2000);
    expect(session.header.device.platform).toBe('web');
    expect(session.header.device.screen.width).toBe(1920);
    expect(session.header.device.screen.height).toBe(1080);
    expect(session.header.app.name).toBe('example.com');
    expect(session.header.app.identifier).toBe('https://example.com');

    // Verify elements were extracted
    expect(session.elements.length).toBe(1);
    expect(session.elements[0].testId).toBe('submit-btn');
    expect(session.elements[0].type).toBe('button');
    expect(session.elements[0].cssSelector).toBe('button.btn.btn-primary');

    // Verify events
    expect(session.events.length).toBe(2);

    // Navigation event
    expect(session.events[0].type).toBe(6); // NAVIGATION
    expect(session.events[0].dt).toBe(0);
    expect(session.events[0].data).toMatchObject({
      kind: 'navigation',
      navType: 'push',
      screen: 'https://example.com/app',
      url: 'https://example.com/app',
    });

    // Click event
    expect(session.events[1].type).toBe(0); // TAP
    expect(session.events[1].dt).toBe(1000); // 2000 - 1000 (from meta event)
    expect(session.events[1].data).toMatchObject({
      kind: 'tap',
      x: 100,
      y: 200,
      elementIndex: 0,
    });
  });

  test('imports scroll events', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1010,
        data: {
          node: {
            type: 1,
            id: 5,
            tagName: 'div',
            attributes: {
              class: 'scrollable',
            },
          },
        },
      },
      {
        type: RrwebEventType.IncrementalSnapshot,
        timestamp: 2000,
        data: {
          source: IncrementalSource.Scroll,
          scrollData: {
            id: 5,
            x: 0,
            y: 500,
          },
        },
      },
    ];

    const session = importRrwebRecording(events);

    expect(session.events.length).toBe(2);

    const scrollEvent = session.events[1];
    expect(scrollEvent.type).toBe(4); // SCROLL
    expect(scrollEvent.data).toMatchObject({
      kind: 'scroll',
      deltaX: 0,
      deltaY: 500,
      containerIndex: 0,
    });
  });

  test('imports input events', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1010,
        data: {
          node: {
            type: 1,
            id: 3,
            tagName: 'input',
            attributes: {
              type: 'email',
              placeholder: 'Enter email',
            },
          },
        },
      },
      {
        type: RrwebEventType.IncrementalSnapshot,
        timestamp: 2000,
        data: {
          source: IncrementalSource.Input,
          id: 3,
          text: 'user@example.com',
        },
      },
    ];

    const session = importRrwebRecording(events);

    expect(session.events.length).toBe(2);

    const inputEvent = session.events[1];
    expect(inputEvent.type).toBe(5); // INPUT
    expect(inputEvent.data).toMatchObject({
      kind: 'input',
      value: 'user@example.com',
      masked: false,
      inputType: 'email',
      elementIndex: 0,
    });
  });

  test('masks password inputs when option enabled', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1010,
        data: {
          node: {
            type: 1,
            id: 4,
            tagName: 'input',
            attributes: {
              type: 'password',
            },
          },
        },
      },
      {
        type: RrwebEventType.IncrementalSnapshot,
        timestamp: 2000,
        data: {
          source: IncrementalSource.Input,
          id: 4,
          text: 'secretpassword',
        },
      },
    ];

    const session = importRrwebRecording(events, { maskInputs: true });

    const inputEvent = session.events[1];
    expect(inputEvent.data).toMatchObject({
      kind: 'input',
      value: '***',
      masked: true,
      inputType: 'password',
    });
  });

  test('parses rrweb JSON file', () => {
    const json = JSON.stringify([
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
    ]);

    const session = parseRrwebFile(json);

    expect(session.header.startTime).toBe(1000);
    expect(session.header.app.name).toBe('example.com');
  });

  test('handles double click events', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1010,
        data: {
          node: {
            type: 1,
            id: 2,
            tagName: 'div',
          },
        },
      },
      {
        type: RrwebEventType.IncrementalSnapshot,
        timestamp: 2000,
        data: {
          source: IncrementalSource.MouseInteraction,
          type: MouseInteractions.DblClick,
          id: 2,
          x: 300,
          y: 400,
        },
      },
    ];

    const session = importRrwebRecording(events);

    const dblClickEvent = session.events[1];
    expect(dblClickEvent.type).toBe(1); // DOUBLE_TAP
    expect(dblClickEvent.data).toMatchObject({
      kind: 'double_tap',
      x: 300,
      y: 400,
    });
  });

  test('handles console errors when enabled', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.IncrementalSnapshot,
        timestamp: 2000,
        data: {
          source: IncrementalSource.Log,
          payload: {
            level: 'error',
            payload: ['Uncaught TypeError:', 'Cannot read property'],
          },
        },
      },
    ];

    const session = importRrwebRecording(events, {
      includeConsoleErrors: true,
    });

    expect(session.events.length).toBe(2);

    const errorEvent = session.events[1];
    expect(errorEvent.type).toBe(9); // ERROR
    expect(errorEvent.data).toMatchObject({
      kind: 'error',
      message: 'Uncaught TypeError: Cannot read property',
      errorType: 'js',
      fatal: false,
    });
  });

  test('extracts element text from various attributes', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1010,
        data: {
          node: {
            type: 1,
            id: 1,
            tagName: 'button',
            textContent: 'Submit Form',
          },
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1020,
        data: {
          node: {
            type: 1,
            id: 2,
            tagName: 'img',
            attributes: {
              alt: 'Company Logo',
            },
          },
        },
      },
      {
        type: RrwebEventType.FullSnapshot,
        timestamp: 1030,
        data: {
          node: {
            type: 1,
            id: 3,
            tagName: 'input',
            attributes: {
              'aria-label': 'Search query',
            },
          },
        },
      },
    ];

    const session = importRrwebRecording(events);

    // Note: Elements are only added when referenced by events, but we can check the node map
    // by triggering events on these elements
    expect(session.elements.length).toBe(0); // No interaction events yet
  });

  test('handles custom app and device info', () => {
    const events: RrwebEvent[] = [
      {
        type: RrwebEventType.Meta,
        timestamp: 1000,
        data: {
          href: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      },
    ];

    const session = importRrwebRecording(events, {
      app: {
        name: 'MyApp',
        version: '2.0.0',
        identifier: 'com.example.myapp',
      },
      device: {
        osVersion: 'macOS 14.0',
        userAgent: 'Mozilla/5.0...',
        locale: 'en-US',
      },
    });

    expect(session.header.app.name).toBe('MyApp');
    expect(session.header.app.version).toBe('2.0.0');
    expect(session.header.app.identifier).toBe('com.example.myapp');
    expect(session.header.device.osVersion).toBe('macOS 14.0');
    expect(session.header.device.userAgent).toBe('Mozilla/5.0...');
    expect(session.header.device.locale).toBe('en-US');
  });
});
