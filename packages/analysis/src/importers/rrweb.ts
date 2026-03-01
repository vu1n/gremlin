/**
 * Generic rrweb session recording importer
 *
 * Imports rrweb recordings from any source (PostHog exports, direct rrweb recordings, etc.)
 * and converts them to GremlinSession format.
 *
 * Reference: https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/dive-into-event.md
 */

import type {
  GremlinSession,
  DeviceInfo,
  AppInfo,
} from '@gremlin/session';
import { generateSessionId, SCHEMA_VERSION } from '@gremlin/session';
import {
  sortEventsByTimestamp,
  buildNodeMapFromEvents,
  convertRrwebEventsToGremlin,
} from './rrweb-core.ts';

// Re-export all rrweb types and enums from the shared module
export {
  RrwebEventType,
  IncrementalSource,
  MouseInteractions,
} from './rrweb-types.ts';
export type {
  RrwebEvent,
  RrwebEventData,
  MetaData,
  FullSnapshotData,
  IncrementalSnapshotData,
  CustomEventData,
  MousePosition,
  SerializedNode,
  AddedNode,
  RemovedNode,
  TextMutation,
  AttributeMutation,
} from './rrweb-types.ts';

import type { RrwebEvent, MetaData, SerializedNode } from './rrweb-types.ts';
import { RrwebEventType, MouseInteractions } from './rrweb-types.ts';

// ============================================================================
// Import Options
// ============================================================================

export interface RrwebImportOptions {
  /**
   * Session ID (auto-generated if not provided)
   */
  sessionId?: string;

  /**
   * App information (optional, extracted from events if not provided)
   */
  app?: Partial<AppInfo>;

  /**
   * Device information (optional, extracted from events if not provided)
   */
  device?: Partial<DeviceInfo>;

  /**
   * Mask input values for privacy
   */
  maskInputs?: boolean;

  /**
   * Whether to include console error events
   */
  includeConsoleErrors?: boolean;

  /**
   * Whether to infer input types from element attributes (default: true)
   */
  inferInputType?: boolean;

  /**
   * Which mouse interactions to treat as taps
   * (default: Click, DblClick, TouchEnd)
   */
  tapInteractions?: MouseInteractions[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Import rrweb recording from event array and convert to GremlinSession.
 */
export function importRrwebRecording(
  events: RrwebEvent[],
  options: RrwebImportOptions = {}
): GremlinSession {
  const opts = {
    sessionId: options.sessionId || generateSessionId(),
    app: options.app || {},
    device: options.device || {},
    maskInputs: options.maskInputs ?? false,
    includeConsoleErrors: options.includeConsoleErrors ?? true,
    inferInputType: options.inferInputType,
    tapInteractions: options.tapInteractions,
  };

  const nodeMap = new Map<number, SerializedNode>();
  const scrollPositions = new Map<number, { x: number; y: number }>();

  const sortedEvents = sortEventsByTimestamp(events);

  if (sortedEvents.length === 0) {
    throw new Error('No events in recording');
  }

  // Extract metadata
  const metaEvent = sortedEvents.find((e) => e.type === RrwebEventType.Meta);
  const metaData = metaEvent?.data as MetaData | undefined;

  const startTime = sortedEvents[0].timestamp;
  const endTime = sortedEvents[sortedEvents.length - 1].timestamp;

  // Build device info
  const device: DeviceInfo = {
    platform: 'web',
    osVersion: opts.device.osVersion || 'unknown',
    screen: opts.device.screen || {
      width: metaData?.width || 1920,
      height: metaData?.height || 1080,
      pixelRatio: 1,
    },
    userAgent: opts.device.userAgent,
    locale: opts.device.locale,
  };

  // Build app info
  let appName = opts.app.name;
  let appIdentifier = opts.app.identifier;

  if (metaData?.href) {
    try {
      const url = new URL(metaData.href);
      appName = appName || url.hostname;
      appIdentifier = appIdentifier || url.origin;
    } catch {
      // Invalid URL, use defaults
    }
  }

  const app: AppInfo = {
    name: appName || 'unknown',
    version: opts.app.version || '1.0.0',
    build: opts.app.build,
    identifier: appIdentifier || 'unknown',
  };

  // Create session
  const session: GremlinSession = {
    header: {
      sessionId: opts.sessionId,
      startTime,
      endTime,
      device,
      app,
      schemaVersion: SCHEMA_VERSION,
    },
    elements: [],
    events: [],
    screenshots: [],
  };

  // Build node map from full snapshots and mutations
  buildNodeMapFromEvents(sortedEvents, nodeMap);

  // Convert events using shared pipeline
  session.events = convertRrwebEventsToGremlin(
    sortedEvents,
    nodeMap,
    session.elements,
    scrollPositions,
    startTime,
    {
      maskInputs: opts.maskInputs,
      includeConsoleErrors: opts.includeConsoleErrors,
      inferInputType: opts.inferInputType ?? true,
      tapInteractions: opts.tapInteractions,
    }
  );

  return session;
}

