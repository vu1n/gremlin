/**
 * Gesture Interceptor - Capture touch events and detect gestures
 *
 * Intercepts React Native's touch responder system to capture taps, swipes, long presses, etc.
 */

import type { GestureResponderEvent, PanResponder } from 'react-native';
import type { TouchData } from './types';

export type GestureType = 'tap' | 'double_tap' | 'long_press' | 'swipe';

export interface GestureEvent {
  type: GestureType;
  x: number;
  y: number;
  timestamp: number;
  target?: any;
  // For swipes
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  duration?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
}

export interface GestureInterceptorConfig {
  onGesture: (gesture: GestureEvent) => void;
  minSwipeDistance?: number;
  longPressDuration?: number;
  doubleTapDelay?: number;
}

/**
 * GestureInterceptor class to detect and track gestures
 */
export class GestureInterceptor {
  private config: Required<GestureInterceptorConfig>;
  private lastTap: { x: number; y: number; timestamp: number } | null = null;
  private touchStart: TouchData | null = null;
  private longPressTimer: NodeJS.Timeout | null = null;
  private isLongPress = false;
  private isSwiping = false;

  constructor(config: GestureInterceptorConfig) {
    this.config = {
      onGesture: config.onGesture,
      minSwipeDistance: config.minSwipeDistance ?? 30,
      longPressDuration: config.longPressDuration ?? 500,
      doubleTapDelay: config.doubleTapDelay ?? 300,
    };
  }

  /**
   * Handle touch start event
   */
  public handleTouchStart = (event: GestureResponderEvent): void => {
    const touch = event.nativeEvent;
    const timestamp = Date.now();

    this.touchStart = {
      identifier: (touch.identifier as any) ?? 0,
      pageX: touch.pageX,
      pageY: touch.pageY,
      timestamp,
      target: event.target,
    };

    this.isLongPress = false;
    this.isSwiping = false;

    // Start long press timer
    this.longPressTimer = setTimeout(() => {
      this.handleLongPress();
    }, this.config.longPressDuration);
  };

  /**
   * Handle touch move event
   */
  public handleTouchMove = (event: GestureResponderEvent): void => {
    if (!this.touchStart) return;

    const touch = event.nativeEvent;
    const deltaX = Math.abs(touch.pageX - this.touchStart.pageX);
    const deltaY = Math.abs(touch.pageY - this.touchStart.pageY);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Cancel long press if moved too much
    if (distance > 10) {
      this.cancelLongPress();
    }

    // Detect swipe start
    if (distance > this.config.minSwipeDistance) {
      this.isSwiping = true;
    }
  };

  /**
   * Handle touch end event
   */
  public handleTouchEnd = (event: GestureResponderEvent): void => {
    this.cancelLongPress();

    if (!this.touchStart) return;

    const touch = event.nativeEvent;
    const timestamp = Date.now();
    const duration = timestamp - this.touchStart.timestamp;

    const deltaX = touch.pageX - this.touchStart.pageX;
    const deltaY = touch.pageY - this.touchStart.pageY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Check for swipe
    if (this.isSwiping && distance > this.config.minSwipeDistance) {
      this.handleSwipe(this.touchStart, touch, duration);
    }
    // Check for tap (not a long press and not a swipe)
    else if (!this.isLongPress && distance < 10) {
      this.handleTap(touch.pageX, touch.pageY, timestamp, event.target);
    }

    this.touchStart = null;
    this.isSwiping = false;
  };

  /**
   * Handle touch cancel event
   */
  public handleTouchCancel = (): void => {
    this.cancelLongPress();
    this.touchStart = null;
    this.isSwiping = false;
  };

  /**
   * Cleanup timers
   */
  public cleanup(): void {
    this.cancelLongPress();
    this.touchStart = null;
    this.lastTap = null;
  }

  // ========================================================================
  // Private Methods - Gesture Detection
  // ========================================================================

  private handleTap(x: number, y: number, timestamp: number, target?: any): void {
    // Check for double tap
    if (this.lastTap) {
      const timeSinceLastTap = timestamp - this.lastTap.timestamp;
      const distance = Math.sqrt(
        Math.pow(x - this.lastTap.x, 2) + Math.pow(y - this.lastTap.y, 2)
      );

      if (timeSinceLastTap < this.config.doubleTapDelay && distance < 50) {
        // Double tap detected
        this.config.onGesture({
          type: 'double_tap',
          x: Math.round(x),
          y: Math.round(y),
          timestamp,
          target,
        });
        this.lastTap = null; // Reset to prevent triple tap
        return;
      }
    }

    // Single tap
    this.config.onGesture({
      type: 'tap',
      x: Math.round(x),
      y: Math.round(y),
      timestamp,
      target,
    });

    // Store for potential double tap
    this.lastTap = { x, y, timestamp };

    // Clear last tap after delay
    setTimeout(() => {
      if (this.lastTap && this.lastTap.timestamp === timestamp) {
        this.lastTap = null;
      }
    }, this.config.doubleTapDelay);
  }

  private handleLongPress(): void {
    if (!this.touchStart) return;

    this.isLongPress = true;

    this.config.onGesture({
      type: 'long_press',
      x: Math.round(this.touchStart.pageX),
      y: Math.round(this.touchStart.pageY),
      timestamp: Date.now(),
      target: this.touchStart.target,
    });

    this.longPressTimer = null;
  }

  private handleSwipe(
    start: TouchData,
    end: { pageX: number; pageY: number },
    duration: number
  ): void {
    const deltaX = end.pageX - start.pageX;
    const deltaY = end.pageY - start.pageY;

    // Determine primary direction
    const direction = this.getSwipeDirection(deltaX, deltaY);

    this.config.onGesture({
      type: 'swipe',
      x: Math.round(start.pageX),
      y: Math.round(start.pageY),
      startX: Math.round(start.pageX),
      startY: Math.round(start.pageY),
      endX: Math.round(end.pageX),
      endY: Math.round(end.pageY),
      duration,
      direction,
      timestamp: Date.now(),
      target: start.target,
    });
  }

  private getSwipeDirection(deltaX: number, deltaY: number): 'up' | 'down' | 'left' | 'right' {
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    if (absDeltaX > absDeltaY) {
      return deltaX > 0 ? 'right' : 'left';
    } else {
      return deltaY > 0 ? 'down' : 'up';
    }
  }

  private cancelLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}

/**
 * Create gesture responder handlers for wrapping root component
 */
export function createGestureHandlers(interceptor: GestureInterceptor) {
  return {
    onStartShouldSetResponder: () => false, // Don't capture - just observe
    onMoveShouldSetResponder: () => false,
    onResponderGrant: interceptor.handleTouchStart,
    onResponderMove: interceptor.handleTouchMove,
    onResponderRelease: interceptor.handleTouchEnd,
    onResponderTerminate: interceptor.handleTouchCancel,
  };
}
