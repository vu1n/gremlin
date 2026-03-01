/**
 * Runtime helper functions for creating and mutating sessions.
 *
 * These are separated from types.ts so that pure type contracts
 * remain free of runtime code, enabling better tree-shaking and
 * clearer module boundaries.
 */

import type { GremlinSession, GremlinEvent, DeviceInfo, AppInfo, ElementInfo } from './types.ts';
import { SCHEMA_VERSION } from './constants.ts';

export function createSession(
  device: DeviceInfo,
  app: AppInfo
): GremlinSession {
  return {
    header: {
      sessionId: generateSessionId(),
      startTime: Date.now(),
      device,
      app,
      schemaVersion: SCHEMA_VERSION,
    },
    elements: [],
    events: [],
    screenshots: [],
  };
}

export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().split('-')[0];
  return `${timestamp}-${random}`;
}

export function getOrCreateElement(
  session: GremlinSession,
  element: Omit<ElementInfo, 'bounds'>
): number {
  // Key-based dedup matching BaseRecorder.getOrCreateElement
  const key = element.testId || element.accessibilityLabel || element.text;

  if (key) {
    const existing = session.elements.findIndex(
      (e) => (e.testId || e.accessibilityLabel || e.text) === key
    );
    if (existing !== -1) {
      return existing;
    }
  }

  // Add new element
  session.elements.push(element as ElementInfo);
  return session.elements.length - 1;
}

export function addEvent(
  session: GremlinSession,
  event: Omit<GremlinEvent, 'dt'>,
  previousTimestamp: number
): number {
  const timestamp = Date.now();
  const dt = timestamp - previousTimestamp;

  session.events.push({
    ...event,
    dt,
  });

  return timestamp;
}
