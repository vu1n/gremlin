/**
 * GremlinProvider - React Context provider for Gremlin recorder
 *
 * Wraps the app to enable gesture capture and provides useGremlin() hook.
 */

import React, { createContext, useContext, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { GremlinRecorder } from './recorder';
import { createGestureHandlers } from './gesture-interceptor';
import type { GremlinRecorderConfig, NavigationRef } from './types';
import type { GremlinSession } from '@gremlin/core';

interface GremlinContextValue {
  recorder: GremlinRecorder | null;
  isRecording: boolean;
  startRecording: (navigationRef?: NavigationRef) => void;
  stopRecording: () => GremlinSession | null;
  getSession: () => GremlinSession | null;
}

const GremlinContext = createContext<GremlinContextValue | null>(null);

export interface GremlinProviderProps {
  /** App children */
  children: ReactNode;

  /** Recorder configuration */
  config: GremlinRecorderConfig;

  /** Navigation ref (if using React Navigation) */
  navigationRef?: NavigationRef;

  /** Auto-start recording on mount */
  autoStart?: boolean;
}

/**
 * GremlinProvider component
 *
 * Wraps your app root to enable session recording.
 *
 * @example
 * ```tsx
 * import { GremlinProvider } from '@gremlin/recorder-react-native';
 * import { useNavigationContainerRef } from '@react-navigation/native';
 *
 * export default function App() {
 *   const navigationRef = useNavigationContainerRef();
 *
 *   return (
 *     <GremlinProvider
 *       config={{
 *         appName: 'MyApp',
 *         appVersion: '1.0.0',
 *         captureGestures: true,
 *         captureNavigation: true,
 *       }}
 *       navigationRef={navigationRef}
 *       autoStart
 *     >
 *       <NavigationContainer ref={navigationRef}>
 *         {// Your app navigation}
 *       </NavigationContainer>
 *     </GremlinProvider>
 *   );
 * }
 * ```
 */
export function GremlinProvider({
  children,
  config,
  navigationRef,
  autoStart = false,
}: GremlinProviderProps): JSX.Element {
  const recorderRef = useRef<GremlinRecorder | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);

  // Initialize recorder once
  useEffect(() => {
    if (!recorderRef.current) {
      recorderRef.current = new GremlinRecorder(config);

      if (autoStart) {
        recorderRef.current.start(navigationRef);
        setIsRecording(true);
      }
    }

    // Cleanup on unmount
    return () => {
      if (recorderRef.current?.isActive()) {
        recorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = (navRef?: NavigationRef) => {
    if (recorderRef.current && !recorderRef.current.isActive()) {
      recorderRef.current.start(navRef || navigationRef);
      setIsRecording(true);
    }
  };

  const stopRecording = (): GremlinSession | null => {
    if (recorderRef.current?.isActive()) {
      const session = recorderRef.current.stop();
      setIsRecording(false);
      return session;
    }
    return null;
  };

  const getSession = (): GremlinSession | null => {
    return recorderRef.current?.getSession() ?? null;
  };

  const contextValue: GremlinContextValue = {
    recorder: recorderRef.current,
    isRecording,
    startRecording,
    stopRecording,
    getSession,
  };

  // Get gesture handlers from recorder - memoize based on isRecording state
  // This ensures handlers are updated when recording starts/stops
  const gestureHandlers = useMemo(() => {
    const gestureInterceptor = recorderRef.current?.getGestureInterceptor();
    return gestureInterceptor ? createGestureHandlers(gestureInterceptor) : {};
  }, [isRecording]);

  return (
    <GremlinContext.Provider value={contextValue}>
      <View
        style={{ flex: 1 }}
        {...gestureHandlers}
        collapsable={false}
      >
        {children}
      </View>
    </GremlinContext.Provider>
  );
}

/**
 * useGremlin hook
 *
 * Access the Gremlin recorder from any component.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isRecording, startRecording, stopRecording, getSession } = useGremlin();
 *
 *   const handleExport = () => {
 *     const session = stopRecording();
 *     if (session) {
 *       console.log('Session:', session);
 *     }
 *   };
 *
 *   return (
 *     <View>
 *       <Text>Recording: {isRecording ? 'Yes' : 'No'}</Text>
 *       <Button onPress={startRecording} title="Start Recording" />
 *       <Button onPress={handleExport} title="Stop & Export" />
 *     </View>
 *   );
 * }
 * ```
 */
export function useGremlin(): GremlinContextValue {
  const context = useContext(GremlinContext);

  if (!context) {
    throw new Error('useGremlin must be used within a GremlinProvider');
  }

  return context;
}

/**
 * Higher-order component to wrap a component with Gremlin recording
 */
export function withGremlin<P extends object>(
  Component: React.ComponentType<P>,
  config: GremlinRecorderConfig
): React.ComponentType<P> {
  return (props: P) => (
    <GremlinProvider config={config}>
      <Component {...props} />
    </GremlinProvider>
  );
}
