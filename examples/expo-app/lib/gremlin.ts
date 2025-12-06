/**
 * Gremlin Session Recorder - React Native Integration
 *
 * Uses the shared GremlinSession format from @gremlin/core for cross-platform
 * analytics compatibility (time to checkout, clicks to checkout, etc.)
 */

import React, { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react';
import { View, Platform, Dimensions, PixelRatio, type GestureResponderEvent } from 'react-native';

// Import shared types from @gremlin/core/session/types (avoid optimizer which uses Node zlib)
import type {
  GremlinSession,
  SessionHeader,
  DeviceInfo,
  AppInfo,
  ElementInfo,
  GremlinEvent,
  TapEvent,
  SwipeEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  AppStateEvent,
  ErrorEvent,
  PerformanceSample,
  Screenshot,
  ElementType as SessionElementType,
} from '@gremlin/core/session/types';
import { EventTypeEnum } from '@gremlin/core/session/types';

// Re-export types for consumers
export type {
  GremlinSession,
  SessionHeader,
  DeviceInfo,
  AppInfo,
  ElementInfo,
  GremlinEvent,
  TapEvent,
  SwipeEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  AppStateEvent,
  ErrorEvent,
  PerformanceSample,
  Screenshot,
};
export { EventTypeEnum };

// Re-export ElementType from core
export type { SessionElementType as ElementType };

// ============================================================================
// Config
// ============================================================================

export interface GremlinRecorderConfig {
  appName: string;
  appVersion: string;
  appBuild?: string;
  appIdentifier?: string;
  debug?: boolean;
  captureGestures?: boolean;
  captureNavigation?: boolean;
  capturePerformance?: boolean;
}

// ============================================================================
// Recorder
// ============================================================================

export class GremlinRecorder {
  private session: GremlinSession;
  private recording: boolean = false;
  private currentScreen: string = 'unknown';
  private lastEventTimestamp: number = 0;
  private elementMap: Map<string, number> = new Map();
  private config: GremlinRecorderConfig;
  private scrollCoalesceCount: number = 0;

  constructor(config: GremlinRecorderConfig) {
    this.config = config;
    this.session = this.createEmptySession();
    this.lastEventTimestamp = Date.now();

    if (this.config.debug) {
      console.log('[Gremlin] Recorder initialized', { sessionId: this.session.header.sessionId });
    }
  }

  private createEmptySession(): GremlinSession {
    const { width, height } = Dimensions.get('window');
    const now = Date.now();

    return {
      header: {
        sessionId: `${now.toString(36)}-${Math.random().toString(36).substring(2, 10)}`,
        startTime: now,
        device: {
          platform: Platform.OS as 'ios' | 'android',
          osVersion: Platform.Version?.toString() || 'unknown',
          screen: {
            width,
            height,
            pixelRatio: PixelRatio.get(),
          },
        },
        app: {
          name: this.config.appName,
          version: this.config.appVersion,
          build: this.config.appBuild,
          identifier: this.config.appIdentifier || this.config.appName,
        },
        schemaVersion: 1,
      },
      elements: [],
      events: [],
      screenshots: [],
    };
  }

  start() {
    this.recording = true;
    this.session = this.createEmptySession();
    this.lastEventTimestamp = this.session.header.startTime;
    this.elementMap.clear();
    this.scrollCoalesceCount = 0;

    if (this.config.debug) {
      console.log('[Gremlin] Recording started');
    }
  }

  stop(): GremlinSession {
    this.recording = false;
    this.session.header.endTime = Date.now();

    if (this.config.debug) {
      console.log('[Gremlin] Recording stopped');
      console.log(`[Gremlin] Captured ${this.session.events.length} events, ${this.session.elements.length} elements`);
    }

    return this.getSession();
  }

  isRecording(): boolean {
    return this.recording;
  }

  private addEvent(type: EventTypeEnum, data: GremlinEvent['data']): void {
    if (!this.recording) return;

    const now = Date.now();
    const dt = now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    this.session.events.push({ dt, type, data });

    if (this.config.debug) {
      console.log(`[Gremlin] Event: ${EventTypeEnum[type]}`, { dt, data });
    }
  }

  private getOrCreateElement(info: Partial<ElementInfo>): number {
    const key = info.testId || info.accessibilityLabel || info.text || 'unknown';

    if (this.elementMap.has(key)) {
      return this.elementMap.get(key)!;
    }

    const element: ElementInfo = {
      type: info.type || 'unknown',
      ...info,
    };

    const index = this.session.elements.length;
    this.session.elements.push(element);
    this.elementMap.set(key, index);

    return index;
  }

  // Public recording methods

  recordTap(testId?: string, data?: { x: number; y: number }) {
    let elementIndex: number | undefined;

    if (testId) {
      elementIndex = this.getOrCreateElement({ testId, type: 'pressable' });
    }

    this.addEvent(EventTypeEnum.TAP, {
      kind: 'tap',
      x: data?.x ?? 0,
      y: data?.y ?? 0,
      elementIndex,
    } as TapEvent);
  }

  recordScroll(data?: { x: number; y: number; deltaX?: number; deltaY?: number }) {
    this.scrollCoalesceCount++;

    // Coalesce scroll events - only emit on significant change or when coalesced count is high
    const shouldEmit = this.scrollCoalesceCount >= 5;

    if (shouldEmit) {
      this.addEvent(EventTypeEnum.SCROLL, {
        kind: 'scroll',
        deltaX: data?.deltaX ?? data?.x ?? 0,
        deltaY: data?.deltaY ?? data?.y ?? 0,
        coalesced: this.scrollCoalesceCount,
      } as ScrollEvent);

      this.scrollCoalesceCount = 0;
    }
  }

  recordInput(testId?: string, value?: string, inputType?: InputEvent['inputType']) {
    let elementIndex: number | undefined;

    if (testId) {
      elementIndex = this.getOrCreateElement({ testId, type: 'input' });
    }

    // Mask sensitive inputs
    const masked = inputType === 'password' || inputType === 'email';

    this.addEvent(EventTypeEnum.INPUT, {
      kind: 'input',
      elementIndex,
      value: masked ? '[MASKED]' : (value ?? ''),
      masked,
      inputType,
    } as InputEvent);
  }

  recordNavigation(
    screen: string,
    navType: NavigationEvent['navType'] = 'push',
    fromScreen?: string
  ) {
    this.addEvent(EventTypeEnum.NAVIGATION, {
      kind: 'navigation',
      navType,
      screen,
      fromScreen: fromScreen || this.currentScreen,
    } as NavigationEvent);

    this.currentScreen = screen;
  }

  recordError(message: string, stack?: string, fatal: boolean = false) {
    this.addEvent(EventTypeEnum.ERROR, {
      kind: 'error',
      message,
      stack,
      errorType: 'js',
      fatal,
    } as ErrorEvent);
  }

  recordAppState(state: AppStateEvent['state']) {
    this.addEvent(EventTypeEnum.APP_STATE, {
      kind: 'app_state',
      state,
    } as AppStateEvent);
  }

  setScreen(screen: string) {
    if (this.recording && screen !== this.currentScreen) {
      this.recordNavigation(screen, 'push', this.currentScreen);
    }
    this.currentScreen = screen;
  }

  getSession(): GremlinSession {
    return {
      ...this.session,
      header: {
        ...this.session.header,
        endTime: this.session.header.endTime || Date.now(),
      },
    };
  }

  getEventCount(): number {
    return this.session.events.length;
  }

  // Analytics helpers

  /**
   * Get time from session start to a specific screen (ms)
   */
  getTimeToScreen(screenName: string): number | null {
    let elapsed = 0;
    for (const event of this.session.events) {
      elapsed += event.dt;
      if (event.type === EventTypeEnum.NAVIGATION) {
        const navData = event.data as NavigationEvent;
        if (navData.screen === screenName) {
          return elapsed;
        }
      }
    }
    return null;
  }

  /**
   * Get number of taps before reaching a specific screen
   */
  getTapsToScreen(screenName: string): number {
    let taps = 0;
    for (const event of this.session.events) {
      if (event.type === EventTypeEnum.TAP) {
        taps++;
      }
      if (event.type === EventTypeEnum.NAVIGATION) {
        const navData = event.data as NavigationEvent;
        if (navData.screen === screenName) {
          return taps;
        }
      }
    }
    return taps;
  }

  /**
   * Get navigation flow (sequence of screens visited)
   */
  getNavigationFlow(): string[] {
    return this.session.events
      .filter(e => e.type === EventTypeEnum.NAVIGATION)
      .map(e => (e.data as NavigationEvent).screen);
  }
}

// ============================================================================
// React Context
// ============================================================================

interface GremlinContextValue {
  recorder: GremlinRecorder | null;
  isRecording: boolean;
  startRecording: () => void;
  stopRecording: () => GremlinSession | null;
  getSession: () => GremlinSession | null;
  getEventCount: () => number;
}

const GremlinContext = createContext<GremlinContextValue | null>(null);

export interface GremlinProviderProps {
  children: ReactNode;
  config: GremlinRecorderConfig;
  autoStart?: boolean;
}

export function GremlinProvider({ children, config, autoStart = false }: GremlinProviderProps) {
  const recorderRef = useRef<GremlinRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const lastTapTime = useRef<number>(0);
  const lastScrollTime = useRef<number>(0);

  useEffect(() => {
    if (!recorderRef.current) {
      recorderRef.current = new GremlinRecorder(config);

      if (autoStart) {
        recorderRef.current.start();
        setIsRecording(true);
      }
    }

    return () => {
      if (recorderRef.current?.isRecording()) {
        recorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = () => {
    if (recorderRef.current && !recorderRef.current.isRecording()) {
      recorderRef.current.start();
      setIsRecording(true);
    }
  };

  const stopRecording = (): GremlinSession | null => {
    if (recorderRef.current?.isRecording()) {
      const session = recorderRef.current.stop();
      setIsRecording(false);
      return session;
    }
    return null;
  };

  const getSession = (): GremlinSession | null => {
    return recorderRef.current?.getSession() ?? null;
  };

  const getEventCount = (): number => {
    return recorderRef.current?.getEventCount() ?? 0;
  };

  // Capture touch start (taps)
  const handleTouchCapture = (event: GestureResponderEvent): boolean => {
    const now = Date.now();
    if (now - lastTapTime.current < 50) return false;
    lastTapTime.current = now;

    if (recorderRef.current?.isRecording()) {
      const { pageX, pageY } = event.nativeEvent;
      recorderRef.current.recordTap(undefined, {
        x: Math.round(pageX),
        y: Math.round(pageY),
      });
    }
    return false;
  };

  // Capture scroll/move events
  const handleMoveCapture = (event: GestureResponderEvent): boolean => {
    const now = Date.now();
    if (now - lastScrollTime.current < 100) return false;
    lastScrollTime.current = now;

    if (recorderRef.current?.isRecording()) {
      const { pageX, pageY } = event.nativeEvent;
      recorderRef.current.recordScroll({
        x: Math.round(pageX),
        y: Math.round(pageY),
      });
    }
    return false;
  };

  const contextValue: GremlinContextValue = {
    recorder: recorderRef.current,
    isRecording,
    startRecording,
    stopRecording,
    getSession,
    getEventCount,
  };

  return React.createElement(
    GremlinContext.Provider,
    { value: contextValue },
    React.createElement(
      View,
      {
        style: { flex: 1 },
        onStartShouldSetResponderCapture: handleTouchCapture,
        onMoveShouldSetResponderCapture: handleMoveCapture,
      },
      children
    )
  );
}

export function useGremlin(): GremlinContextValue {
  const context = useContext(GremlinContext);

  if (!context) {
    throw new Error('useGremlin must be used within a GremlinProvider');
  }

  return context;
}

// ============================================================================
// Singleton (backward compatibility)
// ============================================================================

let gremlinInstance: GremlinRecorder | null = null;

export function initGremlin(config: GremlinRecorderConfig): GremlinRecorder {
  if (!gremlinInstance) {
    gremlinInstance = new GremlinRecorder(config);
    gremlinInstance.start();
  }
  return gremlinInstance;
}

export function getGremlin(): GremlinRecorder {
  if (!gremlinInstance) {
    throw new Error('Gremlin not initialized. Call initGremlin() first.');
  }
  return gremlinInstance;
}
