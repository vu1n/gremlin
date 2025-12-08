/**
 * Example: Merge AST routes with session data
 *
 * This demonstrates:
 * 1. Extracting routes from an Expo app
 * 2. Creating mock session data with navigation events
 * 3. Merging them to produce a GremlinSpec
 * 4. Analyzing coverage
 * 5. Detecting cycles
 */

import { extractExpoRoutes } from './extractors/routes/expo.js';
import { mergeSpecs } from './merger.js';
import { calculateCoverage, formatCoverageReport } from './coverage.js';
import { detectCycles, formatCyclesReport } from './cycle-detector.js';
import type { GremlinSession, DeviceInfo, AppInfo } from '@gremlin/session';
import { createSession, getOrCreateElement, EventTypeEnum } from '@gremlin/session';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('=== Spec Merger Example ===\n');

  // 1. Extract routes from Expo app
  console.log('1. Extracting routes from Expo app...');
  const expoAppDir = path.resolve(__dirname, '../../../examples/expo-app');
  const routeResult = extractExpoRoutes({ rootDir: expoAppDir });

  console.log(`   Found ${routeResult.routes.length} routes\n`);

  // 2. Create mock session data
  console.log('2. Creating mock session data...');
  const sessions = createMockSessions();
  console.log(`   Created ${sessions.length} sessions\n`);

  // 3. Merge AST + session data
  console.log('3. Merging AST routes with session data...');
  const spec = mergeSpecs(routeResult.routes, sessions, {
    platform: 'ios',
    appName: 'expo-app',
  });
  console.log(`   Merged spec: ${spec.states.length} states, ${spec.transitions.length} transitions\n`);

  // 4. Calculate coverage
  console.log('4. Calculating coverage...');
  const coverage = calculateCoverage(spec);
  console.log(formatCoverageReport(coverage));
  console.log('');

  // 5. Detect cycles
  console.log('5. Detecting cycles...');
  const cycles = detectCycles(sessions);
  console.log(formatCyclesReport(cycles));

  // 6. Show spec details
  console.log('\n=== Spec Details ===\n');

  console.log('States:');
  for (const state of spec.states) {
    const source = state.metadata.source;
    const sourceIcon = source === 'ast' ? '📄' : source === 'session' ? '📱' : '✓';
    const route = state.metadata.route ? ` (${state.metadata.route})` : '';
    console.log(`  ${sourceIcon} ${state.name}${route} - observed ${state.observedCount}x`);
  }

  console.log('\nTransitions:');
  for (const transition of spec.transitions) {
    const fromState = spec.states.find(s => s.id === transition.from);
    const toState = spec.states.find(s => s.id === transition.to);
    console.log(
      `  ${fromState?.name ?? transition.from} → ${toState?.name ?? transition.to} (${transition.frequency}x)`
    );
  }
}

/**
 * Create mock session data with realistic navigation patterns
 */
function createMockSessions(): GremlinSession[] {
  const deviceInfo: DeviceInfo = {
    platform: 'ios',
    osVersion: '17.0',
    model: 'iPhone 15',
    screen: {
      width: 393,
      height: 852,
      pixelRatio: 3,
    },
    locale: 'en-US',
  };

  const appInfo: AppInfo = {
    name: 'expo-app',
    version: '1.0.0',
    build: '1',
    identifier: 'com.example.expoapp',
  };

  const sessions: GremlinSession[] = [];

  // Session 1: Normal navigation flow
  sessions.push(createSessionWithFlow(deviceInfo, appInfo, [
    'index',
    'products',
    'product/[id]',
    'cart',
    'checkout',
    'confirmation',
  ]));

  // Session 2: User browses products, adds to cart, but abandons
  sessions.push(createSessionWithFlow(deviceInfo, appInfo, [
    'index',
    'products',
    'product/[id]',
    'products',
    'product/[id]',
    'cart',
    'products',
  ]));

  // Session 3: User navigates to a route not in AST
  sessions.push(createSessionWithFlow(deviceInfo, appInfo, [
    'index',
    'products',
    'secret-admin-panel', // Not in AST routes!
    'products',
  ]));

  // Session 4: User cycles back and forth (navigation cycle)
  sessions.push(createSessionWithFlow(deviceInfo, appInfo, [
    'index',
    'products',
    'index',
    'products',
    'index',
    'products',
  ]));

  // Session 5: User visits settings multiple times (state cycle)
  sessions.push(createSessionWithFlow(deviceInfo, appInfo, [
    'index',
    'settings',
    'profile',
    'settings',
    'profile',
    'settings',
  ]));

  // Session 6: Error loop (error cycle)
  sessions.push(createSessionWithErrors(deviceInfo, appInfo, [
    'index',
    'checkout',
    'index',
    'checkout',
    'index',
  ]));

  return sessions;
}

/**
 * Create a session with a navigation flow
 */
function createSessionWithFlow(
  device: DeviceInfo,
  app: AppInfo,
  screens: string[]
): GremlinSession {
  const session = createSession(device, app);

  let timestamp = session.header.startTime;

  for (const screen of screens) {
    // Add navigation event
    session.events.push({
      dt: 1000 + Math.random() * 2000, // Random delay between 1-3 seconds
      type: EventTypeEnum.NAVIGATION,
      data: {
        kind: 'navigation',
        navType: 'push',
        screen,
      },
    });

    timestamp += session.events[session.events.length - 1].dt;
  }

  session.header.endTime = timestamp;

  return session;
}

/**
 * Create a session with errors
 */
function createSessionWithErrors(
  device: DeviceInfo,
  app: AppInfo,
  screens: string[]
): GremlinSession {
  const session = createSession(device, app);

  let timestamp = session.header.startTime;

  for (let i = 0; i < screens.length; i++) {
    const screen = screens[i];

    // Add navigation event
    session.events.push({
      dt: 1000 + Math.random() * 2000,
      type: EventTypeEnum.NAVIGATION,
      data: {
        kind: 'navigation',
        navType: 'push',
        screen,
      },
    });

    timestamp += session.events[session.events.length - 1].dt;

    // Add error on checkout screen
    if (screen === 'checkout') {
      session.events.push({
        dt: 500,
        type: EventTypeEnum.ERROR,
        data: {
          kind: 'error',
          message: 'Payment processing failed',
          errorType: 'network',
          fatal: false,
        },
      });

      timestamp += 500;
    }
  }

  session.header.endTime = timestamp;

  return session;
}

// Run the example
main().catch(console.error);
