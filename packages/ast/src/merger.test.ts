/**
 * Merger integration tests
 *
 * Tests the spec merger that combines AST routes with session
 * navigation data to produce a unified state machine (GremlinSpec).
 */

import { describe, it, expect } from 'bun:test';
import { mergeSpecs } from './merger';
import type { Route } from './types.js';
import type { GremlinSession, NavigationEvent } from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';

// ============================================================================
// Helpers
// ============================================================================

function makeRoute(path: string, params: string[] = []): Route {
  return {
    path,
    filePath: `/app/${path.replace(/\//g, '_')}.tsx`,
    params,
    source: 'file-based',
    isLayout: false,
    isIndex: path === '/' || path === '',
  };
}

function navEvent(screen: string, dt: number = 100): { dt: number; type: number; data: NavigationEvent } {
  return {
    dt,
    type: EventTypeEnum.NAVIGATION,
    data: { kind: 'navigation', navType: 'push', screen },
  };
}

function makeSession(id: string, events: any[]): GremlinSession {
  return {
    header: {
      sessionId: id,
      startTime: 1000000,
      device: { platform: 'web', osVersion: '14', screen: { width: 1920, height: 1080, pixelRatio: 2 } },
      app: { name: 'TestApp', version: '1.0.0', identifier: 'com.test' },
      schemaVersion: 1,
    },
    elements: [],
    events,
    screenshots: [],
  } as GremlinSession;
}

// ============================================================================
// Tests: Basic Merging
// ============================================================================

describe('mergeSpecs', () => {
  it('creates states from AST routes', () => {
    const routes = [makeRoute('/home'), makeRoute('/settings'), makeRoute('/profile')];
    const spec = mergeSpecs(routes, []);

    expect(spec.states).toHaveLength(3);
    const names = spec.states.map(s => s.name);
    expect(names).toContain('home');
    expect(names).toContain('settings');
    expect(names).toContain('profile');
  });

  it('marks AST-only states with source "ast"', () => {
    const routes = [makeRoute('/home')];
    const spec = mergeSpecs(routes, []);

    expect(spec.states[0].metadata.source).toBe('ast');
  });

  it('creates states from session navigation (no routes)', () => {
    const session = makeSession('s1', [
      navEvent('Home'),
      navEvent('Settings', 500),
    ]);
    const spec = mergeSpecs([], [session]);

    expect(spec.states.length).toBeGreaterThanOrEqual(2);
    const names = spec.states.map(s => s.name);
    expect(names).toContain('Home');
    expect(names).toContain('Settings');
  });

  it('marks session-only states with source "session"', () => {
    const session = makeSession('s1', [
      navEvent('Home'),
      navEvent('NewPage', 500),
    ]);
    const spec = mergeSpecs([], [session]);

    const newPage = spec.states.find(s => s.name === 'NewPage');
    expect(newPage?.metadata.source).toBe('session');
  });

  it('marks states as "both" when present in routes and sessions', () => {
    const routes = [makeRoute('/home')];
    const session = makeSession('s1', [
      navEvent('home'),
      navEvent('other', 500),
    ]);
    const spec = mergeSpecs(routes, [session]);

    const home = spec.states.find(s => s.name === 'home');
    expect(home?.metadata.source).toBe('both');
  });
});

// ============================================================================
// Tests: Transitions
// ============================================================================

describe('transitions', () => {
  it('creates transitions from navigation paths', () => {
    const session = makeSession('s1', [
      navEvent('Home'),
      navEvent('Products', 200),
      navEvent('Cart', 300),
    ]);
    const spec = mergeSpecs([], [session]);

    expect(spec.transitions.length).toBe(2);
    const transNames = spec.transitions.map(t => `${t.from}->${t.to}`);
    expect(transNames).toContain('Home->Products');
    expect(transNames).toContain('Products->Cart');
  });

  it('tracks transition frequency across sessions', () => {
    const s1 = makeSession('s1', [navEvent('Home'), navEvent('Products', 100)]);
    const s2 = makeSession('s2', [navEvent('Home'), navEvent('Products', 100)]);
    const s3 = makeSession('s3', [navEvent('Home'), navEvent('Products', 100)]);

    const spec = mergeSpecs([], [s1, s2, s3]);

    const homeToProducts = spec.transitions.find(
      t => t.from === 'Home' && t.to === 'Products'
    );
    expect(homeToProducts?.frequency).toBe(3);
  });

  it('does not create self-transitions', () => {
    const session = makeSession('s1', [
      navEvent('Home'),
      navEvent('Home', 100), // Same screen
      navEvent('Settings', 200),
    ]);
    const spec = mergeSpecs([], [session]);

    const selfTransitions = spec.transitions.filter(t => t.from === t.to);
    expect(selfTransitions).toHaveLength(0);
  });

  it('ignores non-navigation events', () => {
    const session = makeSession('s1', [
      navEvent('Home'),
      { dt: 100, type: EventTypeEnum.TAP, data: { kind: 'tap', x: 0, y: 0 } },
      navEvent('Settings', 200),
    ]);
    const spec = mergeSpecs([], [session]);

    // Only Home->Settings transition, tap is ignored
    expect(spec.transitions).toHaveLength(1);
  });
});

// ============================================================================
// Tests: Duration Computation
// ============================================================================

describe('state durations', () => {
  it('computes duration from consecutive navigation timestamps', () => {
    // Need 3+ navs: first sets currentScreen, second creates first path
    // (and sets lastNavTimestamp), third creates second path (and computes duration for middle screen)
    const session = makeSession('s1', [
      navEvent('Home', 0),
      navEvent('Products', 1000),  // Path: Home->Products at t=startTime+1000
      navEvent('Cart', 2000),      // Path: Products->Cart at t=startTime+3000
    ]);
    const spec = mergeSpecs([], [session]);

    // Products has a duration: time between its entry (1000ms) and exit (3000ms) = 2000ms
    const products = spec.states.find(s => s.name === 'Products');
    expect(products?.avgDuration).toBe(2000);
  });

  it('averages duration across multiple sessions', () => {
    // Session 1: Products duration = 2000ms
    const s1 = makeSession('s1', [
      navEvent('Home', 0),
      navEvent('Products', 1000),
      navEvent('Cart', 2000),
    ]);
    // Session 2: Products duration = 4000ms
    const s2 = makeSession('s2', [
      navEvent('Home', 0),
      navEvent('Products', 1000),
      navEvent('Cart', 4000),
    ]);
    const spec = mergeSpecs([], [s1, s2]);

    const products = spec.states.find(s => s.name === 'Products');
    // Average = (2000 + 4000) / 2 = 3000
    expect(products?.avgDuration).toBe(3000);
  });
});

// ============================================================================
// Tests: Screen Name Normalization
// ============================================================================

describe('screen name normalization', () => {
  it('strips leading and trailing slashes', () => {
    const routes = [makeRoute('/home/')];
    const spec = mergeSpecs(routes, []);
    expect(spec.states[0].name).toBe('home');
  });

  it('converts empty path to "index"', () => {
    const routes = [makeRoute('/')];
    const spec = mergeSpecs(routes, []);
    expect(spec.states[0].name).toBe('index');
  });

  it('replaces slashes with underscores', () => {
    const routes = [makeRoute('/settings/profile')];
    const spec = mergeSpecs(routes, []);
    expect(spec.states[0].name).toBe('settings_profile');
  });

  it('normalizes dynamic segments [id] to :id', () => {
    const routes = [makeRoute('/product/[id]', ['id'])];
    const spec = mergeSpecs(routes, []);
    expect(spec.states[0].name).toBe('product_:id');
  });
});

// ============================================================================
// Tests: Initial State Selection
// ============================================================================

describe('initial state', () => {
  it('sets initial state to most observed screen', () => {
    // Home appears in 3 sessions, Settings in 1
    const sessions = [
      makeSession('s1', [navEvent('Home'), navEvent('Settings', 100)]),
      makeSession('s2', [navEvent('Home'), navEvent('Products', 100)]),
      makeSession('s3', [navEvent('Home'), navEvent('Products', 100)]),
    ];
    const spec = mergeSpecs([], sessions);

    // Home is the first screen in all 3 sessions
    expect(spec.initialState).toBe('Home' as any);
  });

  it('handles empty routes and sessions', () => {
    const spec = mergeSpecs([], []);
    expect(spec.states).toHaveLength(0);
    expect(spec.transitions).toHaveLength(0);
  });
});

// ============================================================================
// Tests: Metadata
// ============================================================================

describe('metadata', () => {
  it('tracks app versions from sessions', () => {
    const s1 = makeSession('s1', [navEvent('Home')]);
    s1.header.app.version = '1.0.0';
    const s2 = makeSession('s2', [navEvent('Home')]);
    s2.header.app.version = '1.1.0';

    const spec = mergeSpecs([], [s1, s2]);

    expect(spec.metadata.appVersions).toContain('1.0.0');
    expect(spec.metadata.appVersions).toContain('1.1.0');
  });

  it('tracks session count', () => {
    const sessions = [
      makeSession('s1', [navEvent('Home')]),
      makeSession('s2', [navEvent('Home')]),
    ];
    const spec = mergeSpecs([], sessions);
    expect(spec.metadata.sessionCount).toBe(2);
  });

  it('sets platform and app name from options', () => {
    const spec = mergeSpecs([], [], { platform: 'ios', appName: 'MyApp' });
    expect(spec.metadata.platform).toBe('ios');
    expect(spec.name).toBe('MyApp');
  });

  it('stores route path on AST states', () => {
    const routes = [makeRoute('/products/[id]', ['id'])];
    const spec = mergeSpecs(routes, []);

    const state = spec.states[0];
    expect(state.metadata.route).toBe('/products/[id]');
    expect(state.metadata.params).toEqual(['id']);
  });
});

// ============================================================================
// Tests: Complex Multi-Session Scenario
// ============================================================================

describe('complex scenario', () => {
  it('merges AST routes with multi-session navigation', () => {
    const routes = [
      makeRoute('/'),
      makeRoute('/products'),
      makeRoute('/product/[id]', ['id']),
      makeRoute('/cart'),
      makeRoute('/checkout'),
    ];

    const sessions = [
      makeSession('s1', [
        navEvent('index'),
        navEvent('products', 500),
        navEvent('product_:id', 200),
        navEvent('cart', 300),
        navEvent('checkout', 400),
      ]),
      makeSession('s2', [
        navEvent('index'),
        navEvent('products', 300),
        navEvent('product_:id', 150),
        navEvent('products', 200), // Back to products
        navEvent('cart', 100),
      ]),
    ];

    const spec = mergeSpecs(routes, sessions);

    // All 5 routes should be states
    expect(spec.states.length).toBe(5);

    // States seen in both AST and sessions should be 'both'
    const index = spec.states.find(s => s.name === 'index');
    expect(index?.metadata.source).toBe('both');

    // Transitions should exist
    expect(spec.transitions.length).toBeGreaterThanOrEqual(4);

    // products->product_:id should have frequency 2
    const prodToDetail = spec.transitions.find(
      t => t.from === 'products' && t.to === 'product_:id'
    );
    expect(prodToDetail?.frequency).toBe(2);

    // Metadata
    expect(spec.metadata.sessionCount).toBe(2);
  });
});
