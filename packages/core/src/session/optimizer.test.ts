import { describe, it, expect } from 'bun:test';
import {
  optimizeSession,
  deoptimizeSession,
  compressSession,
  decompressSession,
  measureCompression,
  formatCompressionStats,
} from './optimizer.ts';
import { createSession, getOrCreateElement } from './types.ts';
import type { GremlinSession, DeviceInfo, AppInfo } from './types.ts';
import { EventTypeEnum } from './types.ts';

describe('Session Optimizer', () => {
  // Create a sample session for testing
  function createSampleSession(): GremlinSession {
    const device: DeviceInfo = {
      platform: 'ios',
      osVersion: '17.0',
      model: 'iPhone 15 Pro',
      screen: {
        width: 393,
        height: 852,
        pixelRatio: 3,
      },
      locale: 'en-US',
    };

    const app: AppInfo = {
      name: 'TestApp',
      version: '1.0.0',
      build: '100',
      identifier: 'com.example.testapp',
    };

    const session = createSession(device, app);

    // Add some elements
    const loginButton = getOrCreateElement(session, {
      testId: 'login-button',
      accessibilityLabel: 'Log In',
      text: 'Log In',
      type: 'button',
    });

    const emailInput = getOrCreateElement(session, {
      testId: 'email-input',
      accessibilityLabel: 'Email',
      type: 'input',
    });

    const passwordInput = getOrCreateElement(session, {
      testId: 'password-input',
      accessibilityLabel: 'Password',
      type: 'input',
    });

    // Add some events with coordinates
    let previousTimestamp = session.header.startTime;

    // Tap on email input
    session.events.push({
      dt: 500,
      type: EventTypeEnum.TAP,
      data: {
        kind: 'tap',
        x: 196.5,
        y: 300.75,
        elementIndex: emailInput,
      },
      perf: {
        fps: 59.7,
        jsThreadLag: 12.3,
        memoryUsage: 45.2,
        timeSinceNavigation: 1234,
      },
    });
    previousTimestamp += 500;

    // Input email
    session.events.push({
      dt: 1200,
      type: EventTypeEnum.INPUT,
      data: {
        kind: 'input',
        elementIndex: emailInput,
        value: 'user@example.com',
        masked: false,
        inputType: 'email',
      },
    });
    previousTimestamp += 1200;

    // Tap on password input
    session.events.push({
      dt: 300,
      type: EventTypeEnum.TAP,
      data: {
        kind: 'tap',
        x: 196.5,
        y: 400.25,
        elementIndex: passwordInput,
      },
    });
    previousTimestamp += 300;

    // Input password
    session.events.push({
      dt: 2000,
      type: EventTypeEnum.INPUT,
      data: {
        kind: 'input',
        elementIndex: passwordInput,
        value: '••••••••',
        masked: true,
        inputType: 'password',
      },
    });
    previousTimestamp += 2000;

    // Swipe gesture
    session.events.push({
      dt: 500,
      type: EventTypeEnum.SWIPE,
      data: {
        kind: 'swipe',
        startX: 350.2,
        startY: 500.8,
        endX: 50.3,
        endY: 500.9,
        duration: 250,
        direction: 'left',
      },
    });
    previousTimestamp += 500;

    // Scroll event
    session.events.push({
      dt: 100,
      type: EventTypeEnum.SCROLL,
      data: {
        kind: 'scroll',
        deltaX: 0,
        deltaY: -150.5,
        coalesced: 3,
      },
    });
    previousTimestamp += 100;

    // Tap login button
    session.events.push({
      dt: 800,
      type: EventTypeEnum.TAP,
      data: {
        kind: 'tap',
        x: 196.5,
        y: 600.5,
        elementIndex: loginButton,
      },
      perf: {
        fps: 60.0,
        jsThreadLag: 5.1,
        memoryUsage: 48.7,
        timeSinceNavigation: 6734,
      },
    });
    previousTimestamp += 800;

    // Navigation event
    session.events.push({
      dt: 1500,
      type: EventTypeEnum.NAVIGATION,
      data: {
        kind: 'navigation',
        navType: 'push',
        screen: 'Dashboard',
        params: { userId: '12345' },
      },
      perf: {
        fps: 58.3,
        jsThreadLag: 45.7,
        memoryUsage: 52.1,
        timeSinceNavigation: 0,
      },
    });

    session.header.endTime = previousTimestamp + 1500;

    return session;
  }

  it('should optimize and deoptimize a session (round-trip)', () => {
    const original = createSampleSession();
    const optimized = optimizeSession(original);
    const restored = deoptimizeSession(optimized);

    // Check header is preserved
    expect(restored.header).toEqual(original.header);

    // Check elements are preserved (with some rounding)
    expect(restored.elements.length).toBe(original.elements.length);
    for (let i = 0; i < original.elements.length; i++) {
      expect(restored.elements[i].testId).toBe(original.elements[i].testId);
      expect(restored.elements[i].type).toBe(original.elements[i].type);
    }

    // Check events are preserved (with coordinate rounding)
    expect(restored.events.length).toBe(original.events.length);
    for (let i = 0; i < original.events.length; i++) {
      expect(restored.events[i].type).toBe(original.events[i].type);
      expect(restored.events[i].dt).toBe(Math.round(original.events[i].dt));
    }
  });

  it('should compress and decompress a session (round-trip)', () => {
    const original = createSampleSession();
    const compressed = compressSession(original);
    const restored = decompressSession(compressed);

    // Verify it's actually compressed
    expect(compressed).toBeInstanceOf(Buffer);
    expect(compressed.length).toBeGreaterThan(0);

    // Check header is preserved
    expect(restored.header).toEqual(original.header);

    // Check elements count
    expect(restored.elements.length).toBe(original.elements.length);

    // Check events count
    expect(restored.events.length).toBe(original.events.length);

    // Verify event types and structure
    for (let i = 0; i < original.events.length; i++) {
      expect(restored.events[i].type).toBe(original.events[i].type);
      expect(restored.events[i].data.kind).toBe(original.events[i].data.kind);
    }
  });

  it('should achieve significant compression ratio', () => {
    const session = createSampleSession();
    const stats = measureCompression(session);

    console.log('\n' + formatCompressionStats(stats));

    // Should achieve at least 2x compression (conservative target)
    expect(stats.finalRatio).toBeGreaterThan(2);

    // Original should be larger than compressed
    expect(stats.originalSize).toBeGreaterThan(stats.compressedSize);

    // Optimized should be smaller than original
    expect(stats.optimizedSize).toBeLessThan(stats.originalSize);
  });

  it('should round coordinates to integers', () => {
    const session = createSampleSession();
    const optimized = optimizeSession(session);

    // Check that tap coordinates are rounded
    const tapEvent = optimized.events[0];
    expect(tapEvent.data.x).toBe(197); // 196.5 rounded
    expect(tapEvent.data.y).toBe(301); // 300.75 rounded
  });

  it('should encode performance metrics with appropriate precision', () => {
    const session = createSampleSession();
    const optimized = optimizeSession(session);

    // Check first event with performance data
    const eventWithPerf = optimized.events[0];
    expect(eventWithPerf.perf).toBeDefined();

    // FPS should be * 10 (59.7 -> 597)
    expect(eventWithPerf.perf!.fps).toBe(597);

    // Memory should be * 1000 (45.2 MB -> 45200 KB)
    expect(eventWithPerf.perf!.memoryUsage).toBe(45200);

    // JS lag should be rounded
    expect(eventWithPerf.perf!.jsThreadLag).toBe(12);

    // Restore and verify precision
    const restored = deoptimizeSession(optimized);
    const restoredPerf = restored.events[0].perf!;

    expect(restoredPerf.fps).toBe(59.7);
    expect(restoredPerf.memoryUsage).toBe(45.2);
  });

  it('should handle sessions with no performance data', () => {
    const session = createSampleSession();

    // Remove all performance data
    session.events.forEach((event) => {
      delete event.perf;
    });

    const compressed = compressSession(session);
    const restored = decompressSession(compressed);

    expect(restored.events.length).toBe(session.events.length);
    restored.events.forEach((event) => {
      expect(event.perf).toBeUndefined();
    });
  });

  it('should handle empty sessions', () => {
    const device: DeviceInfo = {
      platform: 'web',
      osVersion: '1.0',
      screen: { width: 1920, height: 1080, pixelRatio: 1 },
    };

    const app: AppInfo = {
      name: 'TestApp',
      version: '1.0.0',
      identifier: 'https://example.com',
    };

    const session = createSession(device, app);

    const compressed = compressSession(session);
    const restored = decompressSession(compressed);

    expect(restored.header).toEqual(session.header);
    expect(restored.elements).toEqual([]);
    expect(restored.events).toEqual([]);
    expect(restored.screenshots).toEqual([]);
  });

  it('should preserve element types correctly', () => {
    const session = createSampleSession();
    const optimized = optimizeSession(session);

    // Element types should be numbers in optimized format
    expect(typeof optimized.elements[0].type).toBe('number');

    // Restore and verify types are back to strings
    const restored = deoptimizeSession(optimized);
    expect(typeof restored.elements[0].type).toBe('string');
    expect(restored.elements[0].type).toBe('button');
    expect(restored.elements[1].type).toBe('input');
  });

  it('should provide detailed compression breakdown', () => {
    const session = createSampleSession();
    const stats = measureCompression(session);

    expect(stats.breakdown.header).toBeGreaterThan(0);
    expect(stats.breakdown.elements).toBeGreaterThan(0);
    expect(stats.breakdown.events).toBeGreaterThan(0);

    // Total breakdown should roughly equal original size
    const breakdownTotal =
      stats.breakdown.header +
      stats.breakdown.elements +
      stats.breakdown.events +
      stats.breakdown.screenshots;

    // Allow some variance due to JSON overhead
    expect(breakdownTotal).toBeLessThanOrEqual(stats.originalSize);
  });

  it('should handle large sessions efficiently', () => {
    const session = createSampleSession();

    // Add 1000 more events
    for (let i = 0; i < 1000; i++) {
      session.events.push({
        dt: 50 + Math.random() * 100,
        type: EventTypeEnum.TAP,
        data: {
          kind: 'tap',
          x: Math.random() * 400,
          y: Math.random() * 800,
        },
        perf: {
          fps: 55 + Math.random() * 10,
          jsThreadLag: Math.random() * 50,
          memoryUsage: 40 + Math.random() * 20,
        },
      });
    }

    const stats = measureCompression(session);

    console.log('\nLarge session compression:');
    console.log(formatCompressionStats(stats));

    // Large sessions should achieve even better compression
    expect(stats.finalRatio).toBeGreaterThan(5);
  });
});
