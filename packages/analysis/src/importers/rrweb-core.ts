/**
 * Shared rrweb conversion utilities
 *
 * Both the generic rrweb importer and the PostHog importer process rrweb
 * DOM snapshots into Gremlin elements. This module contains the shared
 * logic: node map building, element type inference, text extraction,
 * CSS selector generation, element deduplication, and the core event
 * conversion pipeline (sorting, dt computation, event mapping).
 */

import type {
  ElementInfo,
  GremlinSession,
  GremlinEvent,
  TapEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  ErrorEvent,
} from '@gremlin/session';
import { EventTypeEnum } from '@gremlin/session';
import type {
  SerializedNode,
  RrwebEvent,
  IncrementalSnapshotData,
  FullSnapshotData,
  MetaData,
} from './rrweb-types.ts';
import {
  RrwebEventType,
  IncrementalSource,
  MouseInteractions,
} from './rrweb-types.ts';

/**
 * Recursively build a node-ID -> SerializedNode lookup map from a DOM snapshot.
 */
function buildNodeMap(
  node: SerializedNode,
  nodeMap: Map<number, SerializedNode>
): void {
  nodeMap.set(node.id, node);
  if (node.childNodes) {
    for (const child of node.childNodes) {
      buildNodeMap(child, nodeMap);
    }
  }
}

/**
 * Infer Gremlin ElementInfo.type from an rrweb serialized DOM node.
 */
function getElementType(node: SerializedNode): ElementInfo['type'] {
  const tag = node.tagName?.toLowerCase();

  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
      return 'link';
    case 'input':
    case 'textarea':
    case 'select':
      return 'input';
    case 'img':
    case 'svg':
      return 'image';
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'aside':
    case 'header':
    case 'footer':
    case 'nav':
      return 'container';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'list_item';
    case 'dialog':
    case 'modal':
      return 'modal';
    default:
      // Check for interactive elements
      if (
        node.attributes?.['role'] === 'button' ||
        node.attributes?.['onclick']
      ) {
        return 'pressable';
      }
      if (node.textContent) return 'text';
      return 'unknown';
  }
}

/**
 * Extract human-readable text content from an rrweb serialized DOM node.
 * Checks textContent, aria-label, title, alt, and placeholder in that order.
 */
function getTextContent(node: SerializedNode): string | undefined {
  if (node.textContent) {
    const text = node.textContent.trim();
    return text || undefined;
  }

  if (node.attributes?.['aria-label']) {
    return node.attributes['aria-label'];
  }

  if (node.attributes?.['title']) {
    return node.attributes['title'];
  }

  if (node.attributes?.['alt']) {
    return node.attributes['alt'];
  }

  if (node.attributes?.['placeholder']) {
    return node.attributes['placeholder'];
  }

  return undefined;
}

/**
 * Generate a CSS selector from an rrweb serialized DOM node.
 * Produces `tag#id` or `tag.class1.class2.class3` (max 3 classes, CSS-in-JS filtered).
 */
function generateCssSelector(node: SerializedNode): string | undefined {
  if (!node.tagName) return undefined;

  let selector = node.tagName.toLowerCase();

  // Add ID if present (most specific)
  if (node.attributes?.['id']) {
    selector += `#${node.attributes['id']}`;
    return selector;
  }

  // Add classes if present
  if (node.attributes?.['class']) {
    const classes = node.attributes['class']
      .split(' ')
      .filter(Boolean)
      .filter((c) => !c.match(/^_/)); // Filter out CSS-in-JS classes
    if (classes.length > 0) {
      selector += '.' + classes.slice(0, 3).join('.'); // Limit to 3 classes
    }
  }

  return selector;
}

/**
 * Extract an ElementInfo from an rrweb serialized DOM node.
 */
function extractElementInfo(node: SerializedNode): ElementInfo {
  return {
    type: getElementType(node),
    testId: node.attributes?.['data-testid'] || node.attributes?.['data-test'],
    accessibilityLabel:
      node.attributes?.['aria-label'] || node.attributes?.['aria-labelledby'],
    text: getTextContent(node),
    cssSelector: generateCssSelector(node),
    attributes: node.attributes,
  };
}

/**
 * Look up (or create) an element in the session elements array by rrweb node ID.
 * Uses key-based dedup: testId and accessibilityLabel are unique enough on their
 * own, but text is combined with type and the rrweb node ID to avoid collisions
 * between repeated labels (e.g. multiple "Save" buttons).
 */
function getOrCreateElement(
  nodeId: number | undefined,
  nodeMap: Map<number, SerializedNode>,
  elements: ElementInfo[],
  elementNodeIds: Map<number, number>
): number | undefined {
  if (nodeId === undefined) return undefined;

  const node = nodeMap.get(nodeId);
  if (!node) return undefined;

  const elementInfo = extractElementInfo(node);

  // testId and accessibilityLabel are assumed unique per page
  const key = elementInfo.testId
    || elementInfo.accessibilityLabel
    || (elementInfo.text
      ? `${elementInfo.type}:${nodeId}:${elementInfo.text}`
      : undefined);

  const existingIndex = key
    ? elements.findIndex((e, i) => {
        const eKey = e.testId
          || e.accessibilityLabel
          || (e.text ? `${e.type}:${elementNodeIds.get(i)}:${e.text}` : undefined);
        return eKey === key;
      })
    : -1;

  if (existingIndex !== -1) {
    return existingIndex;
  }

  elements.push(elementInfo);
  const newIndex = elements.length - 1;
  elementNodeIds.set(newIndex, nodeId);
  return newIndex;
}

/**
 * Compute scroll deltas from rrweb absolute scroll positions.
 * Tracks previous positions per node ID in the provided map.
 */
function computeScrollDelta(
  nodeId: number,
  x: number,
  y: number,
  scrollPositions: Map<number, { x: number; y: number }>
): { deltaX: number; deltaY: number } {
  const prev = scrollPositions.get(nodeId) ?? { x: 0, y: 0 };
  const deltaX = x - prev.x;
  const deltaY = y - prev.y;
  scrollPositions.set(nodeId, { x, y });
  return { deltaX, deltaY };
}

// ============================================================================
// Core Event Conversion Pipeline
// ============================================================================

/**
 * Sort rrweb events by timestamp (ascending).
 */
export function sortEventsByTimestamp(events: RrwebEvent[]): RrwebEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Compute the time delta between two timestamps.
 */
function computeDt(
  currentTimestamp: number,
  previousTimestamp: number
): number {
  return currentTimestamp - previousTimestamp;
}

/**
 * Build a node map from a sorted array of rrweb events.
 * Processes both FullSnapshot nodes and IncrementalSnapshot mutation adds.
 */
export function buildNodeMapFromEvents(
  sortedEvents: RrwebEvent[],
  nodeMap: Map<number, SerializedNode>
): void {
  for (const event of sortedEvents) {
    if (event.type === RrwebEventType.FullSnapshot) {
      const data = event.data as FullSnapshotData;
      buildNodeMap(data.node, nodeMap);
    } else if (event.type === RrwebEventType.IncrementalSnapshot) {
      const data = event.data as IncrementalSnapshotData;
      if (data.source === IncrementalSource.Mutation && data.adds) {
        for (const add of data.adds) {
          buildNodeMap(add.node, nodeMap);
        }
      }
    }
  }
}

/**
 * Options for the core event conversion pipeline.
 */
export interface ConvertRrwebOptions {
  /** Whether to mask password inputs */
  maskInputs?: boolean;
  /** Whether to include console error events */
  includeConsoleErrors?: boolean;
  /** Whether to determine input types from element attributes (rrweb importer does, PostHog does not) */
  inferInputType?: boolean;
  /** Which mouse interactions to treat as taps (default: Click, DblClick, TouchEnd) */
  tapInteractions?: MouseInteractions[];
}

const DEFAULT_TAP_INTERACTIONS = [
  MouseInteractions.Click,
  MouseInteractions.DblClick,
  MouseInteractions.TouchEnd,
];

/**
 * Convert a single rrweb event to zero or more GremlinEvents (without dt).
 * This is the shared conversion logic used by both importers.
 */
function convertSingleRrwebEvent(
  event: RrwebEvent,
  nodeMap: Map<number, SerializedNode>,
  elements: ElementInfo[],
  elementNodeIds: Map<number, number>,
  scrollPositions: Map<number, { x: number; y: number }>,
  options: ConvertRrwebOptions = {}
): Omit<GremlinEvent, 'dt'>[] {
  const {
    maskInputs = false,
    includeConsoleErrors = true,
    inferInputType = false,
    tapInteractions = DEFAULT_TAP_INTERACTIONS,
  } = options;

  const results: Omit<GremlinEvent, 'dt'>[] = [];

  switch (event.type) {
    case RrwebEventType.Meta: {
      const data = event.data as MetaData;
      results.push({
        type: EventTypeEnum.NAVIGATION,
        data: {
          kind: 'navigation',
          navType: 'push',
          screen: data.href,
          url: data.href,
        } as NavigationEvent,
      });
      break;
    }

    case RrwebEventType.IncrementalSnapshot: {
      const data = event.data as IncrementalSnapshotData;

      switch (data.source) {
        case IncrementalSource.MouseInteraction: {
          if (data.type === undefined || data.x === undefined || data.y === undefined) {
            break;
          }

          const elementIndex = getOrCreateElement(data.id, nodeMap, elements, elementNodeIds);

          if (data.type === MouseInteractions.DblClick) {
            results.push({
              type: EventTypeEnum.DOUBLE_TAP,
              data: {
                kind: 'double_tap',
                x: data.x,
                y: data.y,
                elementIndex,
              } as TapEvent,
            });
          } else if (tapInteractions.includes(data.type)) {
            results.push({
              type: EventTypeEnum.TAP,
              data: {
                kind: 'tap',
                x: data.x,
                y: data.y,
                elementIndex,
              } as TapEvent,
            });
          }
          break;
        }

        case IncrementalSource.Scroll: {
          if (!data.scrollData) break;

          const containerIndex = getOrCreateElement(
            data.scrollData.id, nodeMap, elements, elementNodeIds
          );
          const { deltaX, deltaY } = computeScrollDelta(
            data.scrollData.id, data.scrollData.x, data.scrollData.y, scrollPositions
          );

          results.push({
            type: EventTypeEnum.SCROLL,
            data: {
              kind: 'scroll',
              deltaX,
              deltaY,
              containerIndex,
            } as ScrollEvent,
          });
          break;
        }

        case IncrementalSource.Input: {
          if (data.text === undefined || data.id === undefined) break;

          const elementIndex = getOrCreateElement(data.id, nodeMap, elements, elementNodeIds);

          let inputType: InputEvent['inputType'] = 'text';
          if (inferInputType && elementIndex !== undefined) {
            const element = elements[elementIndex];
            const typeAttr = element.attributes?.['type'];
            if (typeAttr === 'password') inputType = 'password';
            else if (typeAttr === 'email') inputType = 'email';
            else if (typeAttr === 'number') inputType = 'number';
            else if (typeAttr === 'tel') inputType = 'phone';
          }

          const isPassword = inputType === 'password';

          results.push({
            type: EventTypeEnum.INPUT,
            data: {
              kind: 'input',
              elementIndex,
              value: maskInputs && isPassword ? '***' : data.text,
              masked: maskInputs && isPassword,
              inputType,
            } as InputEvent,
          });
          break;
        }

        case IncrementalSource.Log: {
          if (!includeConsoleErrors) break;
          if (!data.payload || typeof data.payload !== 'object') break;

          const payload = data.payload as { level?: string; payload?: string[] };
          if (payload.level === 'error' && payload.payload) {
            results.push({
              type: EventTypeEnum.ERROR,
              data: {
                kind: 'error',
                message: payload.payload.join(' '),
                errorType: 'js',
                fatal: false,
              } as ErrorEvent,
            });
          }
          break;
        }
      }
      break;
    }
  }

  return results;
}

/**
 * Convert an array of sorted rrweb events to GremlinEvents with dt.
 * This is the main event mapping loop shared by both importers.
 */
export function convertRrwebEventsToGremlin(
  sortedEvents: RrwebEvent[],
  nodeMap: Map<number, SerializedNode>,
  elements: ElementInfo[],
  scrollPositions: Map<number, { x: number; y: number }>,
  startTimestamp: number,
  options: ConvertRrwebOptions = {}
): GremlinEvent[] {
  const gremlinEvents: GremlinEvent[] = [];
  const elementNodeIds = new Map<number, number>();
  let previousTimestamp = startTimestamp;

  for (const event of sortedEvents) {
    const converted = convertSingleRrwebEvent(
      event, nodeMap, elements, elementNodeIds, scrollPositions, options
    );

    for (const gremlinEvent of converted) {
      const dt = computeDt(event.timestamp, previousTimestamp);
      gremlinEvents.push({ dt, ...gremlinEvent });
      previousTimestamp = event.timestamp;
    }
  }

  return gremlinEvents;
}
