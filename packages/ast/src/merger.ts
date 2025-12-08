/**
 * Spec Merger - Combines AST routes with session data to produce GremlinSpec
 */

import type { Route } from './types.js';
import type { GremlinSession, NavigationEvent } from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';
import type {
  GremlinSpec,
  State,
  StateId,
  Transition,
  TransitionEvent,
  EventType,
} from '@gremlin/analysis';
import {
  createSpec,
  createState,
  createTransition,
  stateId,
  transitionId,
} from '@gremlin/analysis';

/**
 * Source tracking for states and transitions
 */
export type SourceType = 'ast' | 'session' | 'both';

/**
 * Extended state with source tracking
 */
export interface StateWithSource extends State {
  metadata: State['metadata'] & {
    source: SourceType;
    route?: string;
    params?: string[];
  };
}

/**
 * Extended transition with source tracking
 */
export interface TransitionWithSource extends Transition {
  metadata?: {
    source: SourceType;
  };
}

/**
 * Spec with source-tracked states and transitions
 */
export interface GremlinSpecWithSources extends Omit<GremlinSpec, 'states' | 'transitions'> {
  states: StateWithSource[];
  transitions: TransitionWithSource[];
}

/**
 * Navigation path extracted from a session
 */
interface NavigationPath {
  from: string;
  to: string;
  timestamp: number;
  sessionId: string;
}

/**
 * Merge AST routes and session data into a unified GremlinSpec
 */
export function mergeSpecs(
  astRoutes: Route[],
  sessions: GremlinSession[],
  options: {
    platform?: 'web' | 'ios' | 'android' | 'cross-platform';
    appName?: string;
  } = {}
): GremlinSpecWithSources {
  const platform = options.platform ?? 'cross-platform';
  const appName = options.appName ?? 'app';

  // Create base spec
  const spec = createSpec(appName, platform) as GremlinSpecWithSources;

  // Extract app versions from sessions
  const appVersions = new Set(sessions.map(s => s.header.app.version));
  spec.metadata.appVersions = Array.from(appVersions);
  spec.metadata.sessionCount = sessions.length;

  // Track states by screen name
  const stateMap = new Map<string, StateWithSource>();

  // 1. Create states from AST routes
  for (const route of astRoutes) {
    const screenName = normalizeScreenName(route.path);
    const state = createState(screenName, screenName) as StateWithSource;

    state.metadata = {
      source: 'ast' as const,
      route: route.path,
      params: route.params,
    };
    state.observedCount = 0;

    stateMap.set(screenName, state);
  }

  // 2. Extract navigation paths from sessions
  const navigationPaths = extractNavigationPaths(sessions);

  // 3. Process navigation paths
  const transitionMap = new Map<string, TransitionWithSource>();
  const stateObservations = new Map<string, number>();
  const stateDurations = new Map<string, number[]>();

  for (const path of navigationPaths) {
    // Track state observations
    stateObservations.set(path.from, (stateObservations.get(path.from) ?? 0) + 1);
    stateObservations.set(path.to, (stateObservations.get(path.to) ?? 0) + 1);

    // Create or update states from sessions
    if (!stateMap.has(path.from)) {
      const state = createState(path.from, path.from) as StateWithSource;
      state.metadata = { source: 'session' as const };
      state.observedCount = 0;
      stateMap.set(path.from, state);
    }
    if (!stateMap.has(path.to)) {
      const state = createState(path.to, path.to) as StateWithSource;
      state.metadata = { source: 'session' as const };
      state.observedCount = 0;
      stateMap.set(path.to, state);
    }

    // Mark states as 'both' if they appear in AST and sessions
    const fromState = stateMap.get(path.from)!;
    const toState = stateMap.get(path.to)!;

    if (fromState.metadata.source === 'ast') {
      fromState.metadata.source = 'both';
    }
    if (toState.metadata.source === 'ast') {
      toState.metadata.source = 'both';
    }

    // Create transition
    const transitionKey = `${path.from}->${path.to}`;
    let transition = transitionMap.get(transitionKey);

    if (!transition) {
      const event: TransitionEvent = {
        type: 'navigation' as EventType,
        data: {
          screen: path.to,
        },
      };

      transition = createTransition(
        transitionKey,
        stateId(path.from),
        stateId(path.to),
        event
      ) as TransitionWithSource;

      transition.frequency = 0;
      transition.metadata = { source: 'session' as const };
      transitionMap.set(transitionKey, transition);
    }

    transition.frequency += 1;
  }

  // 4. Update state observation counts and durations
  for (const [screenName, state] of stateMap) {
    state.observedCount = stateObservations.get(screenName) ?? 0;

    const durations = stateDurations.get(screenName);
    if (durations && durations.length > 0) {
      state.avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    }
  }

  // 5. Set initial state
  if (stateMap.size > 0) {
    // Use most frequently observed state as initial, or first route, or first state
    const sortedByObservation = Array.from(stateMap.entries())
      .sort((a, b) => b[1].observedCount - a[1].observedCount);

    if (sortedByObservation.length > 0) {
      spec.initialState = sortedByObservation[0][1].id;
    }
  }

  // 6. Assemble final spec
  spec.states = Array.from(stateMap.values());
  spec.transitions = Array.from(transitionMap.values());
  spec.metadata.updatedAt = new Date().toISOString();

  return spec;
}

/**
 * Extract navigation paths from session events
 */
function extractNavigationPaths(sessions: GremlinSession[]): NavigationPath[] {
  const paths: NavigationPath[] = [];

  for (const session of sessions) {
    let currentScreen: string | null = null;
    let currentTimestamp = session.header.startTime;

    for (const event of session.events) {
      currentTimestamp += event.dt;

      if (event.type === EventTypeEnum.NAVIGATION) {
        const navEvent = event.data as NavigationEvent;
        const nextScreen = normalizeScreenName(navEvent.screen);

        if (currentScreen && currentScreen !== nextScreen) {
          paths.push({
            from: currentScreen,
            to: nextScreen,
            timestamp: currentTimestamp,
            sessionId: session.header.sessionId,
          });
        }

        currentScreen = nextScreen;
      }
    }
  }

  return paths;
}

/**
 * Normalize screen/route name for consistent comparison
 */
function normalizeScreenName(name: string): string {
  // Remove leading/trailing slashes
  let normalized = name.replace(/^\/+|\/+$/g, '');

  // Replace empty string with 'index'
  if (normalized === '') {
    normalized = 'index';
  }

  // Replace slashes with underscores for state IDs
  normalized = normalized.replace(/\//g, '_');

  // Normalize dynamic segments
  normalized = normalized.replace(/\[([^\]]+)\]/g, ':$1');

  return normalized;
}
