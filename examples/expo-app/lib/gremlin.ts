/**
 * Gremlin Session Recorder - React Native Integration
 *
 * Extends BaseRecorder from @gremlin/core for shared batching and event logic.
 * Adds React Native-specific lifecycle handling (AppState) and gesture capture.
 */

import React, { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react';
import { View, Platform, Dimensions, PixelRatio, AppState, type GestureResponderEvent, type AppStateStatus } from 'react-native';

// Import shared types from @gremlin/core/session/types (avoid optimizer which uses Node zlib)
import type {
  GremlinSession,
  DeviceInfo,
  AppInfo,
  ElementInfo,
} from '@gremlin/core/session/types';
import { BaseRecorder, type BaseRecorderConfig } from '@gremlin/core/session/recorder-base';

// Re-export types for consumers
export type { GremlinSession, DeviceInfo, AppInfo, ElementInfo };
export { EventTypeEnum } from '@gremlin/core/session/types';

// ============================================================================
// Config
// ============================================================================

export interface GremlinRecorderConfig extends BaseRecorderConfig {
  appName: string;
  appVersion: string;
  appBuild?: string;
  appIdentifier?: string;
  /** Capture app state changes (background/foreground) */
  captureAppState?: boolean;
}

// ============================================================================
// React Native Recorder
// ============================================================================

/**
 * React Native session recorder.
 * Extends BaseRecorder with:
 * - Platform-specific device/app info
 * - AppState lifecycle handling for flush on background
 */
export class GremlinRecorder extends BaseRecorder {
  private appConfig: GremlinRecorderConfig;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  constructor(config: GremlinRecorderConfig) {
    super({
      enableBatching: config.enableBatching ?? true,
      scrollBatchWindow: config.scrollBatchWindow ?? 150,
      debug: config.debug ?? false,
    });

    this.appConfig = config;

    if (this.appConfig.debug) {
      console.log('[Gremlin] React Native recorder initialized');
    }
  }

  // ========================================================================
  // Abstract method implementations
  // ========================================================================

  protected getDeviceInfo(): DeviceInfo {
    const { width, height } = Dimensions.get('window');

    return {
      platform: Platform.OS as 'ios' | 'android',
      osVersion: Platform.Version?.toString() || 'unknown',
      model: undefined, // Could add expo-device for this
      screen: {
        width,
        height,
        pixelRatio: PixelRatio.get(),
      },
    };
  }

  protected getAppInfo(): AppInfo {
    return {
      name: this.appConfig.appName,
      version: this.appConfig.appVersion,
      build: this.appConfig.appBuild,
      identifier: this.appConfig.appIdentifier || this.appConfig.appName,
    };
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  override start(): void {
    super.start();

    // Subscribe to app state changes
    if (this.appConfig.captureAppState !== false) {
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }
  }

  override stop(): GremlinSession | null {
    // Unsubscribe from app state
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    return super.stop();
  }

  override destroy(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    super.destroy();
  }

  // ========================================================================
  // App State Handling
  // ========================================================================

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (!this.isRecording()) return;

    // Map React Native app state to our event types
    const stateMap: Record<AppStateStatus, 'active' | 'background' | 'inactive'> = {
      active: 'active',
      background: 'background',
      inactive: 'inactive',
      unknown: 'inactive',
      extension: 'background',
    };

    const state = stateMap[nextAppState] || 'inactive';

    // Record the state change (this also flushes on background)
    this.recordAppState(state);

    if (this.appConfig.debug) {
      console.log('[Gremlin] App state changed:', state);
    }
  };

  // ========================================================================
  // Convenience methods for React Native
  // ========================================================================

  /**
   * Record a tap with optional testID lookup.
   */
  recordTapWithTestId(testId: string | undefined, x: number, y: number): void {
    this.recordTap(x, y, testId ? { testId } : undefined);
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
      if (recorderRef.current) {
        recorderRef.current.destroy();
        recorderRef.current = null;
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

  // Capture touch start (taps) - no deduplication, all taps are valuable
  const handleTouchCapture = (event: GestureResponderEvent): boolean => {
    const now = Date.now();
    // Small debounce to avoid double-firing, but not too aggressive
    if (now - lastTapTime.current < 50) return false;
    lastTapTime.current = now;

    if (recorderRef.current?.isRecording()) {
      const { pageX, pageY } = event.nativeEvent;
      recorderRef.current.recordTap(Math.round(pageX), Math.round(pageY));
    }
    return false;
  };

  // Capture scroll/move events - these will be batched by BaseRecorder
  const handleMoveCapture = (event: GestureResponderEvent): boolean => {
    const now = Date.now();
    // Throttle raw move events before they hit the batcher
    if (now - lastScrollTime.current < 50) return false;
    lastScrollTime.current = now;

    if (recorderRef.current?.isRecording()) {
      const { pageX, pageY } = event.nativeEvent;
      // For move events, we treat position as scroll delta
      // The batcher will coalesce these
      recorderRef.current.recordScroll(Math.round(pageX), Math.round(pageY));
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
