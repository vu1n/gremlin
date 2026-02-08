import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BaseRecorder } from './recorder-base';
import type { BaseRecorderConfig } from './recorder-base';
import type { DeviceInfo, AppInfo, ScrollEvent, TapEvent, InputEvent, NavigationEvent, ErrorEvent, AppStateEvent } from './types';
import { EventTypeEnum } from './types';

// Concrete test implementation of abstract BaseRecorder
class TestRecorder extends BaseRecorder {
  constructor(config?: BaseRecorderConfig) {
    super(config);
  }

  protected getDeviceInfo(): DeviceInfo {
    return {
      platform: 'web',
      osVersion: '14.0',
      model: 'TestDevice',
      screen: { width: 1920, height: 1080, pixelRatio: 2 },
    };
  }

  protected getAppInfo(): AppInfo {
    return {
      name: 'TestApp',
      version: '1.0.0',
      identifier: 'com.test.app',
    };
  }
}

describe('BaseRecorder', () => {
  let recorder: TestRecorder;

  beforeEach(() => {
    recorder = new TestRecorder();
  });

  afterEach(() => {
    recorder.destroy();
  });

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('lifecycle', () => {
    it('start() creates a session and sets isRecording to true', () => {
      expect(recorder.isRecording()).toBe(false);
      recorder.start();
      expect(recorder.isRecording()).toBe(true);
      expect(recorder.getSession()).not.toBeNull();
    });

    it('start() creates session with correct header fields', () => {
      const before = Date.now();
      recorder.start();
      const after = Date.now();

      const session = recorder.getSession()!;
      expect(session.header.sessionId).toBeTruthy();
      expect(session.header.startTime).toBeGreaterThanOrEqual(before);
      expect(session.header.startTime).toBeLessThanOrEqual(after);
      expect(session.header.schemaVersion).toBe(1);
      expect(session.header.device.platform).toBe('web');
      expect(session.header.device.model).toBe('TestDevice');
      expect(session.header.app.name).toBe('TestApp');
      expect(session.header.app.version).toBe('1.0.0');
    });

    it('start() initializes empty arrays', () => {
      recorder.start();
      const session = recorder.getSession()!;
      expect(session.elements).toEqual([]);
      expect(session.events).toEqual([]);
      expect(session.screenshots).toEqual([]);
    });

    it('stop() returns session with endTime', () => {
      recorder.start();
      const before = Date.now();
      const session = recorder.stop();
      const after = Date.now();

      expect(session).not.toBeNull();
      expect(session!.header.endTime).toBeGreaterThanOrEqual(before);
      expect(session!.header.endTime).toBeLessThanOrEqual(after);
    });

    it('stop() sets isRecording to false', () => {
      recorder.start();
      expect(recorder.isRecording()).toBe(true);
      recorder.stop();
      expect(recorder.isRecording()).toBe(false);
    });

    it('stop() when not started returns null', () => {
      const result = recorder.stop();
      expect(result).toBeNull();
    });

    it('getSession() returns null when not recording', () => {
      expect(recorder.getSession()).toBeNull();
    });

    it('getSession() returns session copy during recording', () => {
      recorder.start();
      const s1 = recorder.getSession();
      const s2 = recorder.getSession();
      expect(s1).not.toBeNull();
      expect(s2).not.toBeNull();
      // Should be different object references (copy)
      expect(s1).not.toBe(s2);
    });

    it('getSession() fills in endTime if not set', () => {
      recorder.start();
      const session = recorder.getSession()!;
      // During recording, endTime should be set to current time
      expect(session.header.endTime).toBeDefined();
      expect(session.header.endTime).toBeGreaterThan(0);
    });

    it('getEventCount() returns 0 before recording', () => {
      expect(recorder.getEventCount()).toBe(0);
    });

    it('getEventCount() tracks events', () => {
      recorder.start();
      recorder.recordTap(100, 200);
      recorder.recordTap(150, 250);
      expect(recorder.getEventCount()).toBe(2);
    });
  });

  // ========================================================================
  // Event Recording
  // ========================================================================

  describe('recordTap', () => {
    it('adds a tap event with correct type and coordinates', () => {
      recorder.start();
      recorder.recordTap(100, 200);

      const session = recorder.getSession()!;
      expect(session.events).toHaveLength(1);
      expect(session.events[0].type).toBe(EventTypeEnum.TAP);

      const data = session.events[0].data as TapEvent;
      expect(data.kind).toBe('tap');
      expect(data.x).toBe(100);
      expect(data.y).toBe(200);
    });

    it('rounds coordinates', () => {
      recorder.start();
      recorder.recordTap(100.7, 200.3);

      const data = recorder.getSession()!.events[0].data as TapEvent;
      expect(data.x).toBe(101);
      expect(data.y).toBe(200);
    });

    it('records element info and sets elementIndex', () => {
      recorder.start();
      recorder.recordTap(50, 60, { testId: 'btn-submit', type: 'button' });

      const session = recorder.getSession()!;
      const data = session.events[0].data as TapEvent;
      expect(data.elementIndex).toBe(0);
      expect(session.elements).toHaveLength(1);
      expect(session.elements[0].testId).toBe('btn-submit');
    });

    it('defaults element type to pressable when not specified', () => {
      recorder.start();
      recorder.recordTap(50, 60, { testId: 'my-btn' });

      const session = recorder.getSession()!;
      expect(session.elements[0].type).toBe('pressable');
    });

    it('has no elementIndex when no element info provided', () => {
      recorder.start();
      recorder.recordTap(50, 60);

      const data = recorder.getSession()!.events[0].data as TapEvent;
      expect(data.elementIndex).toBeUndefined();
    });
  });

  describe('recordInput', () => {
    it('adds an input event with value', () => {
      recorder.start();
      recorder.recordInput('hello', 'text');

      const session = recorder.getSession()!;
      expect(session.events).toHaveLength(1);
      expect(session.events[0].type).toBe(EventTypeEnum.INPUT);

      const data = session.events[0].data as InputEvent;
      expect(data.kind).toBe('input');
      expect(data.value).toBe('hello');
      expect(data.masked).toBe(false);
      expect(data.inputType).toBe('text');
    });

    it('masks password input', () => {
      recorder.start();
      recorder.recordInput('secret123', 'password');

      const data = recorder.getSession()!.events[0].data as InputEvent;
      expect(data.value).toBe('[MASKED]');
      expect(data.masked).toBe(true);
    });

    it('masks email input', () => {
      recorder.start();
      recorder.recordInput('user@example.com', 'email');

      const data = recorder.getSession()!.events[0].data as InputEvent;
      expect(data.value).toBe('[MASKED]');
      expect(data.masked).toBe(true);
    });

    it('does not mask text input', () => {
      recorder.start();
      recorder.recordInput('search query', 'text');

      const data = recorder.getSession()!.events[0].data as InputEvent;
      expect(data.value).toBe('search query');
      expect(data.masked).toBe(false);
    });

    it('records element info for input', () => {
      recorder.start();
      recorder.recordInput('test', 'text', { testId: 'search-field' });

      const session = recorder.getSession()!;
      const data = session.events[0].data as InputEvent;
      expect(data.elementIndex).toBe(0);
      expect(session.elements[0].testId).toBe('search-field');
      expect(session.elements[0].type).toBe('input');
    });
  });

  describe('recordNavigation', () => {
    it('adds navigation event with screen and navType', () => {
      recorder.start();
      recorder.recordNavigation('HomeScreen', 'push');

      const session = recorder.getSession()!;
      expect(session.events).toHaveLength(1);
      expect(session.events[0].type).toBe(EventTypeEnum.NAVIGATION);

      const data = session.events[0].data as NavigationEvent;
      expect(data.kind).toBe('navigation');
      expect(data.screen).toBe('HomeScreen');
      expect(data.navType).toBe('push');
    });

    it('updates currentScreen', () => {
      recorder.start();
      recorder.recordNavigation('ScreenA');
      recorder.recordNavigation('ScreenB');

      const session = recorder.getSession()!;
      // Second navigation should have fromScreen = ScreenA
      const data = session.events[1].data as NavigationEvent & { fromScreen?: string };
      expect(data.fromScreen).toBe('ScreenA');
    });

    it('defaults navType to push', () => {
      recorder.start();
      recorder.recordNavigation('Settings');

      const data = recorder.getSession()!.events[0].data as NavigationEvent;
      expect(data.navType).toBe('push');
    });

    it('includes params when provided', () => {
      recorder.start();
      recorder.recordNavigation('Profile', 'push', { userId: '123' });

      const data = recorder.getSession()!.events[0].data as NavigationEvent;
      expect(data.params).toEqual({ userId: '123' });
    });
  });

  describe('recordError', () => {
    it('adds error event with message', () => {
      recorder.start();
      recorder.recordError('Something went wrong');

      const session = recorder.getSession()!;
      expect(session.events).toHaveLength(1);
      expect(session.events[0].type).toBe(EventTypeEnum.ERROR);

      const data = session.events[0].data as ErrorEvent;
      expect(data.kind).toBe('error');
      expect(data.message).toBe('Something went wrong');
      expect(data.errorType).toBe('js');
      expect(data.fatal).toBe(false);
    });

    it('records stack trace', () => {
      recorder.start();
      recorder.recordError('Error', 'js', 'Error: ...\n  at foo.ts:10');

      const data = recorder.getSession()!.events[0].data as ErrorEvent;
      expect(data.stack).toBe('Error: ...\n  at foo.ts:10');
    });

    it('records fatal errors', () => {
      recorder.start();
      recorder.recordError('Fatal crash', 'native', undefined, true);

      const data = recorder.getSession()!.events[0].data as ErrorEvent;
      expect(data.fatal).toBe(true);
      expect(data.errorType).toBe('native');
    });
  });

  describe('recordAppState', () => {
    it('adds app_state event', () => {
      recorder.start();
      recorder.recordAppState('background');

      const session = recorder.getSession()!;
      expect(session.events).toHaveLength(1);
      expect(session.events[0].type).toBe(EventTypeEnum.APP_STATE);

      const data = session.events[0].data as AppStateEvent;
      expect(data.kind).toBe('app_state');
      expect(data.state).toBe('background');
    });

    it('records active state', () => {
      recorder.start();
      recorder.recordAppState('active');

      const data = recorder.getSession()!.events[0].data as AppStateEvent;
      expect(data.state).toBe('active');
    });
  });

  // ========================================================================
  // Delta Timestamps
  // ========================================================================

  describe('delta timestamps', () => {
    it('first event has dt >= 0', () => {
      recorder.start();
      recorder.recordTap(0, 0);

      const dt = recorder.getSession()!.events[0].dt;
      expect(dt).toBeGreaterThanOrEqual(0);
    });

    it('second event dt reflects time since first event', async () => {
      recorder.start();
      recorder.recordTap(0, 0);

      await new Promise((resolve) => setTimeout(resolve, 50));

      recorder.recordTap(10, 10);

      const events = recorder.getSession()!.events;
      expect(events).toHaveLength(2);
      // Second event's dt should be >= 50ms (the delay)
      expect(events[1].dt).toBeGreaterThanOrEqual(40); // allow some timing slack
    });
  });

  // ========================================================================
  // Element Deduplication
  // ========================================================================

  describe('element deduplication', () => {
    it('same element info returns same index', () => {
      recorder.start();
      recorder.recordTap(10, 10, { testId: 'btn-1', type: 'button' });
      recorder.recordTap(20, 20, { testId: 'btn-1', type: 'button' });

      const session = recorder.getSession()!;
      expect(session.elements).toHaveLength(1);

      const ev1 = session.events[0].data as TapEvent;
      const ev2 = session.events[1].data as TapEvent;
      expect(ev1.elementIndex).toBe(0);
      expect(ev2.elementIndex).toBe(0);
    });

    it('different elements get different indices', () => {
      recorder.start();
      recorder.recordTap(10, 10, { testId: 'btn-1', type: 'button' });
      recorder.recordTap(20, 20, { testId: 'btn-2', type: 'button' });

      const session = recorder.getSession()!;
      expect(session.elements).toHaveLength(2);

      const ev1 = session.events[0].data as TapEvent;
      const ev2 = session.events[1].data as TapEvent;
      expect(ev1.elementIndex).toBe(0);
      expect(ev2.elementIndex).toBe(1);
    });

    it('deduplicates by testId as primary key', () => {
      recorder.start();
      recorder.recordTap(10, 10, { testId: 'same-id', type: 'button' });
      recorder.recordInput('val', 'text', { testId: 'same-id' });

      // Same testId => same element index
      const session = recorder.getSession()!;
      const tapData = session.events[0].data as TapEvent;
      const inputData = session.events[1].data as InputEvent;
      expect(tapData.elementIndex).toBe(inputData.elementIndex);
    });
  });

  // ========================================================================
  // Scroll Batching
  // ========================================================================

  describe('scroll batching', () => {
    it('coalesces rapid scrolls when batching enabled', () => {
      recorder.start();
      recorder.recordScroll(0, 10);
      recorder.recordScroll(0, 20);
      recorder.recordScroll(0, 30);

      // Scrolls are batched, so events should not appear yet
      expect(recorder.getEventCount()).toBe(0);

      recorder.flush();

      // After flush, one coalesced event
      expect(recorder.getEventCount()).toBe(1);
      const data = recorder.getSession()!.events[0].data as ScrollEvent;
      expect(data.deltaY).toBe(60);
      expect(data.coalesced).toBe(3);
    });

    it('emits every scroll immediately when batching disabled', () => {
      const noBatchRecorder = new TestRecorder({ enableBatching: false });
      noBatchRecorder.start();

      noBatchRecorder.recordScroll(0, 10);
      noBatchRecorder.recordScroll(0, 20);

      expect(noBatchRecorder.getEventCount()).toBe(2);

      noBatchRecorder.destroy();
    });
  });

  // ========================================================================
  // flush()
  // ========================================================================

  describe('flush', () => {
    it('flushes pending scroll batch into session events', () => {
      recorder.start();
      recorder.recordScroll(0, 50);
      expect(recorder.getEventCount()).toBe(0);

      recorder.flush();
      expect(recorder.getEventCount()).toBe(1);
    });

    it('is idempotent - double flush does not duplicate events', () => {
      recorder.start();
      recorder.recordScroll(0, 50);

      recorder.flush();
      recorder.flush();

      expect(recorder.getEventCount()).toBe(1);
    });
  });

  // ========================================================================
  // destroy()
  // ========================================================================

  describe('destroy', () => {
    it('clears session and sets isRecording to false', () => {
      recorder.start();
      expect(recorder.isRecording()).toBe(true);
      expect(recorder.getSession()).not.toBeNull();

      recorder.destroy();
      expect(recorder.isRecording()).toBe(false);
      expect(recorder.getSession()).toBeNull();
    });
  });

  // ========================================================================
  // Analytics Helpers
  // ========================================================================

  describe('getTimeToScreen', () => {
    it('returns null when not recording', () => {
      expect(recorder.getTimeToScreen('Home')).toBeNull();
    });

    it('returns elapsed time to reach a screen', () => {
      recorder.start();
      recorder.recordNavigation('Login');
      recorder.recordNavigation('Home');

      const time = recorder.getTimeToScreen('Home');
      expect(time).not.toBeNull();
      expect(time).toBeGreaterThanOrEqual(0);
    });

    it('returns null for a screen not visited', () => {
      recorder.start();
      recorder.recordNavigation('Login');

      expect(recorder.getTimeToScreen('Settings')).toBeNull();
    });
  });

  describe('getTapsToScreen', () => {
    it('returns 0 when not recording', () => {
      expect(recorder.getTapsToScreen('Home')).toBe(0);
    });

    it('counts taps before reaching a screen', () => {
      recorder.start();
      recorder.recordTap(10, 10);
      recorder.recordTap(20, 20);
      recorder.recordNavigation('Home');
      recorder.recordTap(30, 30); // after navigation

      const taps = recorder.getTapsToScreen('Home');
      expect(taps).toBe(2);
    });
  });

  describe('getNavigationFlow', () => {
    it('returns empty array when not recording', () => {
      expect(recorder.getNavigationFlow()).toEqual([]);
    });

    it('returns sequence of screens visited', () => {
      recorder.start();
      recorder.recordNavigation('Login');
      recorder.recordTap(10, 10); // non-nav event should be skipped
      recorder.recordNavigation('Home');
      recorder.recordNavigation('Settings');

      expect(recorder.getNavigationFlow()).toEqual(['Login', 'Home', 'Settings']);
    });
  });

  // ========================================================================
  // Events not recorded when not recording
  // ========================================================================

  describe('events when not recording', () => {
    it('does not add events when not started', () => {
      recorder.recordTap(10, 10);
      expect(recorder.getEventCount()).toBe(0);
    });

    it('does not add events after stop', () => {
      recorder.start();
      recorder.recordTap(10, 10);
      recorder.stop();
      recorder.recordTap(20, 20);

      // Session is cleared from internal state after stop, but we already have the returned session
      // getEventCount returns 0 because recording is false
      expect(recorder.getEventCount()).toBe(1);
    });
  });

  describe('setCurrentScreen', () => {
    it('sets the current screen without recording navigation', () => {
      recorder.start();
      recorder.setCurrentScreen('InitialScreen');
      recorder.recordNavigation('NextScreen');

      const session = recorder.getSession()!;
      expect(session.events).toHaveLength(1); // only the navigation event, not setCurrentScreen
      const data = session.events[0].data as NavigationEvent & { fromScreen?: string };
      expect(data.fromScreen).toBe('InitialScreen');
    });
  });
});
