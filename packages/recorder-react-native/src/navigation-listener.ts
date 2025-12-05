/**
 * Navigation Listener - Track React Navigation events
 *
 * Integrates with @react-navigation/native to capture screen changes and navigation actions.
 */

import type { NavigationRef } from './types';

export type NavigationType = 'push' | 'pop' | 'replace' | 'reset' | 'tab' | 'modal';

export interface NavigationChange {
  type: NavigationType;
  screen: string;
  params?: Record<string, unknown>;
  previousScreen?: string;
}

export interface NavigationListenerConfig {
  onNavigationChange: (change: NavigationChange) => void;
  navigationRef?: NavigationRef | null;
  maskParams?: boolean;
}

/**
 * NavigationListener class to track React Navigation events
 */
export class NavigationListener {
  private config: Required<NavigationListenerConfig>;
  private unsubscribe: (() => void) | null = null;
  private currentRoute: { name: string; params?: any } | null = null;
  private routeHistory: string[] = [];

  constructor(config: NavigationListenerConfig) {
    this.config = {
      onNavigationChange: config.onNavigationChange,
      navigationRef: config.navigationRef ?? null,
      maskParams: config.maskParams ?? true,
    };
  }

  /**
   * Start listening to navigation events
   */
  public start(navigationRef?: NavigationRef): void {
    const ref = navigationRef || this.config.navigationRef;

    if (!ref) {
      console.warn(
        'GremlinRecorder: No navigation ref provided. Navigation tracking disabled.'
      );
      return;
    }

    // Get initial route
    try {
      this.currentRoute = ref.getCurrentRoute() ?? null;
      if (this.currentRoute) {
        this.routeHistory.push(this.currentRoute.name);
      }
    } catch (error) {
      console.warn('Failed to get initial route:', error);
    }

    // Listen for state changes
    this.unsubscribe = ref.addListener('state', this.handleStateChange);
  }

  /**
   * Stop listening to navigation events
   */
  public stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Get current route
   */
  public getCurrentRoute(): { name: string; params?: any } | null {
    return this.currentRoute;
  }

  /**
   * Get route history
   */
  public getRouteHistory(): string[] {
    return [...this.routeHistory];
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private handleStateChange = (e: any): void => {
    const state = e?.data?.state;
    if (!state) return;

    const route = this.getActiveRoute(state);
    if (!route) return;

    const previousRoute = this.currentRoute;
    this.currentRoute = route;

    // Determine navigation type
    const navType = this.determineNavigationType(previousRoute, route);

    // Add to history
    this.routeHistory.push(route.name);

    // Mask params if configured
    const params = this.config.maskParams
      ? this.maskSensitiveParams(route.params)
      : route.params;

    // Emit navigation change
    this.config.onNavigationChange({
      type: navType,
      screen: route.name,
      params,
      previousScreen: previousRoute?.name,
    });
  };

  /**
   * Get the active route from navigation state
   */
  private getActiveRoute(state: any): { name: string; params?: any } | null {
    if (!state) return null;

    // Traverse nested navigators to find the active route
    let route = state.routes?.[state.index ?? 0];
    while (route?.state) {
      route = route.state.routes?.[route.state.index ?? 0];
    }

    if (!route) return null;

    return {
      name: route.name,
      params: route.params,
    };
  }

  /**
   * Determine navigation type based on route changes
   */
  private determineNavigationType(
    previous: { name: string; params?: any } | null,
    current: { name: string; params?: any }
  ): NavigationType {
    if (!previous) {
      return 'push';
    }

    // Check if it's a pop (going back in history)
    const previousIndex = this.routeHistory.lastIndexOf(current.name);
    if (previousIndex >= 0 && previousIndex < this.routeHistory.length - 1) {
      return 'pop';
    }

    // Check for modal patterns (route name contains 'Modal' or 'Sheet')
    if (current.name.toLowerCase().includes('modal') ||
        current.name.toLowerCase().includes('sheet')) {
      return 'modal';
    }

    // Check for tab navigation (same level, different screen)
    // This is a heuristic - proper tab detection would need navigator type info
    if (this.routeHistory.length > 2 &&
        this.routeHistory[this.routeHistory.length - 2] !== current.name) {
      return 'tab';
    }

    // Default to push for new screens
    return 'push';
  }

  /**
   * Mask sensitive parameter values
   */
  private maskSensitiveParams(params?: any): Record<string, unknown> | undefined {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const masked: Record<string, unknown> = {};
    const sensitiveKeys = ['token', 'password', 'secret', 'key', 'auth', 'api'];

    for (const [key, value] of Object.entries(params)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some((sk) => lowerKey.includes(sk));

      if (isSensitive) {
        masked[key] = '***';
      } else if (typeof value === 'object' && value !== null) {
        // Recursively mask nested objects
        masked[key] = this.maskSensitiveParams(value);
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }
}

/**
 * Helper to create a navigation ref and listener together
 */
export function createNavigationListener(
  config: Omit<NavigationListenerConfig, 'navigationRef'>
): { listener: NavigationListener; ref: any } {
  // This would typically be created using React Navigation's createNavigationContainerRef
  // But since we're in a pure TS file, we'll just provide the type
  const listener = new NavigationListener(config);

  return {
    listener,
    ref: null, // User must provide their own navigationRef from React Navigation
  };
}
