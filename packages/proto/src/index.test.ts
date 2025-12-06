import { describe, test, expect } from 'bun:test';
import {
  encodeSession,
  decodeSession,
  estimateCompressionRatio,
} from './index';
import type { GremlinSession } from './generated/session';
import { Platform, ImageFormat } from './generated/session';
import { EventTypeEnum } from './generated/events';
import { ElementType } from './generated/elements';

describe('@gremlin/proto', () => {
  test('should encode and decode a session', () => {
    const session: GremlinSession = {
      header: {
        sessionId: 'test-123',
        startTime: Date.now(),
        schemaVersion: 1,
        device: {
          platform: Platform.PLATFORM_WEB,
          osVersion: 'macOS 14.0',
          screen: {
            width: 1920,
            height: 1080,
            pixelRatio: 2,
          },
        },
        app: {
          name: 'TestApp',
          version: '1.0.0',
          identifier: 'com.test.app',
        },
      },
      elements: [
        {
          testId: 'submit-button',
          type: ElementType.ELEMENT_TYPE_BUTTON,
          text: 'Submit',
          bounds: { x: 100, y: 200, width: 120, height: 40 },
          attributes: {},
        },
      ],
      events: [
        {
          dt: 0,
          type: EventTypeEnum.EVENT_TYPE_TAP,
          tap: {
            kind: 0, // TAP_KIND_TAP
            x: 160,
            y: 220,
            elementIndex: 0,
          },
        },
      ],
      screenshots: [],
    };

    // Encode
    const encoded = encodeSession(session);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    // Decode
    const decoded = decodeSession(encoded);
    expect(decoded.header!.sessionId).toBe('test-123');
    expect(decoded.header!.schemaVersion).toBe(1);
    expect(decoded.elements).toHaveLength(1);
    expect(decoded.elements[0].testId).toBe('submit-button');
    expect(decoded.events).toHaveLength(1);
    expect(decoded.events[0].type).toBe(EventTypeEnum.EVENT_TYPE_TAP);
  });

  test('should achieve compression', () => {
    const session: GremlinSession = {
      header: {
        sessionId: 'test-compression',
        startTime: Date.now(),
        schemaVersion: 1,
        device: {
          platform: Platform.PLATFORM_WEB,
          osVersion: 'macOS 14.0',
          screen: { width: 1920, height: 1080, pixelRatio: 2 },
        },
        app: {
          name: 'TestApp',
          version: '1.0.0',
          identifier: 'com.test.app',
        },
      },
      elements: [
        {
          testId: 'button-1',
          type: ElementType.ELEMENT_TYPE_BUTTON,
          text: 'Click Me',
          attributes: {},
        },
      ],
      events: Array.from({ length: 100 }, (_, i) => ({
        dt: 100, // 100ms between events
        type: EventTypeEnum.EVENT_TYPE_TAP,
        tap: {
          kind: 0,
          x: 100 + i,
          y: 200 + i,
          elementIndex: 0,
        },
      })),
      screenshots: [],
    };

    const ratio = estimateCompressionRatio(session);
    console.log(`Compression ratio: ${ratio.toFixed(3)} (${(1 / ratio).toFixed(1)}x)`);

    // Proto should be significantly smaller than JSON
    expect(ratio).toBeLessThan(0.5); // At least 2x compression
  });

  test('should handle all event types', () => {
    const session: GremlinSession = {
      header: {
        sessionId: 'test-events',
        startTime: Date.now(),
        schemaVersion: 1,
        device: {
          platform: Platform.PLATFORM_IOS,
          osVersion: 'iOS 17.0',
          model: 'iPhone 15',
          screen: { width: 393, height: 852, pixelRatio: 3 },
        },
        app: {
          name: 'MobileApp',
          version: '2.0.0',
          identifier: 'com.test.mobile',
        },
      },
      elements: [],
      events: [
        {
          dt: 0,
          type: EventTypeEnum.EVENT_TYPE_TAP,
          tap: { kind: 0, x: 100, y: 200 },
        },
        {
          dt: 500,
          type: EventTypeEnum.EVENT_TYPE_SCROLL,
          scroll: { deltaX: 0, deltaY: -100 },
        },
        {
          dt: 1000,
          type: EventTypeEnum.EVENT_TYPE_NAVIGATION,
          navigation: {
            navType: 0, // PUSH
            screen: 'Profile',
          },
        },
        {
          dt: 2000,
          type: EventTypeEnum.EVENT_TYPE_ERROR,
          error: {
            message: 'Test error',
            errorType: 0, // JS
            fatal: false,
          },
        },
      ],
      screenshots: [],
    };

    const encoded = encodeSession(session);
    const decoded = decodeSession(encoded);

    expect(decoded.events).toHaveLength(4);
    expect(decoded.events[0].tap).toBeDefined();
    expect(decoded.events[1].scroll).toBeDefined();
    expect(decoded.events[2].navigation).toBeDefined();
    expect(decoded.events[3].error).toBeDefined();
  });

  test('should handle optional fields', () => {
    const session: GremlinSession = {
      header: {
        sessionId: 'test-optional',
        startTime: Date.now(),
        endTime: Date.now() + 60000, // Optional field
        schemaVersion: 1,
        device: {
          platform: Platform.PLATFORM_ANDROID,
          osVersion: 'Android 14',
          model: 'Pixel 8', // Optional field
          locale: 'en-US', // Optional field
          screen: { width: 1080, height: 2400, pixelRatio: 2.75 },
        },
        app: {
          name: 'AndroidApp',
          version: '1.5.0',
          build: '42', // Optional field
          identifier: 'com.test.android',
        },
      },
      elements: [],
      events: [],
      screenshots: [
        {
          id: 'screenshot-1',
          timestamp: Date.now(),
          format: ImageFormat.IMAGE_FORMAT_WEBP,
          data: 'https://example.com/screenshot.webp',
          isUrl: true,
          width: 1080,
          height: 2400,
          quality: 80,
          isDiff: false,
        },
      ],
    };

    const encoded = encodeSession(session);
    const decoded = decodeSession(encoded);

    expect(decoded.header!.endTime).toBeDefined();
    expect(decoded.header!.device!.model).toBe('Pixel 8');
    expect(decoded.header!.device!.locale).toBe('en-US');
    expect(decoded.header!.app!.build).toBe('42');
    expect(decoded.screenshots).toHaveLength(1);
    expect(decoded.screenshots[0].isUrl).toBe(true);
  });
});
