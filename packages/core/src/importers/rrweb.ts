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
  GremlinEvent,
  ElementInfo,
  DeviceInfo,
  AppInfo,
  TapEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  ErrorEvent,
} from '../session/types.ts';
import { EventTypeEnum } from '../session/types.ts';

// ============================================================================
// RRWeb Types
// ============================================================================

/**
 * rrweb event types
 */
export enum RrwebEventType {
  DomContentLoaded = 0,
  Load = 1,
  FullSnapshot = 2,
  IncrementalSnapshot = 3,
  Meta = 4,
  Custom = 5,
  Plugin = 6,
}

/**
 * Incremental snapshot sources (user interactions)
 */
export enum IncrementalSource {
  Mutation = 0,
  MouseMove = 1,
  MouseInteraction = 2,
  Scroll = 3,
  ViewportResize = 4,
  Input = 5,
  TouchMove = 6,
  MediaInteraction = 7,
  StyleSheetRule = 8,
  CanvasMutation = 9,
  Font = 10,
  Log = 11,
  Drag = 12,
  StyleDeclaration = 13,
}

/**
 * Mouse interaction types
 */
export enum MouseInteractions {
  MouseUp = 0,
  MouseDown = 1,
  Click = 2,
  ContextMenu = 3,
  DblClick = 4,
  Focus = 5,
  Blur = 6,
  TouchStart = 7,
  TouchMove_Departed = 8, // Deprecated
  TouchEnd = 9,
}

/**
 * Base rrweb event structure
 */
export interface RrwebEvent {
  type: RrwebEventType;
  timestamp: number;
  data: RrwebEventData;
}

/**
 * Union of all possible rrweb event data types
 */
export type RrwebEventData =
  | MetaData
  | FullSnapshotData
  | IncrementalSnapshotData
  | CustomEventData;

/**
 * Meta event data (page info)
 */
export interface MetaData {
  href: string;
  width: number;
  height: number;
}

/**
 * Full snapshot data (complete DOM tree)
 */
export interface FullSnapshotData {
  node: SerializedNode;
  initialOffset?: {
    top: number;
    left: number;
  };
}

/**
 * Incremental snapshot data (DOM changes and interactions)
 */
export interface IncrementalSnapshotData {
  source: IncrementalSource;
  positions?: MousePosition[];
  id?: number;
  x?: number;
  y?: number;
  type?: MouseInteractions;
  scrollData?: {
    id: number;
    x: number;
    y: number;
  };
  text?: string;
  isChecked?: boolean;
  source_type?: number;
  payload?: unknown;
  adds?: AddedNode[];
  removes?: RemovedNode[];
  texts?: TextMutation[];
  attributes?: AttributeMutation[];
}

/**
 * Custom event data
 */
export interface CustomEventData {
  tag: string;
  payload: unknown;
}

/**
 * Mouse position data
 */
export interface MousePosition {
  x: number;
  y: number;
  id: number;
  timeOffset: number;
}

/**
 * Serialized DOM node
 */
export interface SerializedNode {
  type: number;
  id: number;
  tagName?: string;
  attributes?: Record<string, string>;
  childNodes?: SerializedNode[];
  textContent?: string;
  isSVG?: boolean;
}

/**
 * Added node in mutation
 */
export interface AddedNode {
  parentId: number;
  previousId?: number;
  nextId?: number;
  node: SerializedNode;
}

/**
 * Removed node in mutation
 */
export interface RemovedNode {
  parentId: number;
  id: number;
}

/**
 * Text content mutation
 */
export interface TextMutation {
  id: number;
  value: string;
}

/**
 * Attribute mutation
 */
export interface AttributeMutation {
  id: number;
  attributes: Record<string, string | null>;
}

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
}

// ============================================================================
// RRWeb Importer
// ============================================================================

/**
 * Converts rrweb recordings to GremlinSession format
 */
export class RrwebImporter {
  private nodeMap: Map<number, SerializedNode> = new Map();
  private options: Required<RrwebImportOptions>;

  constructor(options: RrwebImportOptions = {}) {
    this.options = {
      sessionId: options.sessionId || this.generateSessionId(),
      app: options.app || {},
      device: options.device || {},
      maskInputs: options.maskInputs ?? false,
      includeConsoleErrors: options.includeConsoleErrors ?? true,
    };
  }

  /**
   * Import rrweb recording and convert to GremlinSession
   */
  importRecording(events: RrwebEvent[]): GremlinSession {
    // Reset node map
    this.nodeMap.clear();

    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

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
      osVersion: this.options.device.osVersion || 'unknown',
      screen: this.options.device.screen || {
        width: metaData?.width || 1920,
        height: metaData?.height || 1080,
        pixelRatio: 1,
      },
      userAgent: this.options.device.userAgent,
      locale: this.options.device.locale,
    };

    // Build app info
    let appName = this.options.app.name;
    let appIdentifier = this.options.app.identifier;

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
      version: this.options.app.version || '1.0.0',
      build: this.options.app.build,
      identifier: appIdentifier || 'unknown',
    };

    // Create session
    const session: GremlinSession = {
      header: {
        sessionId: this.options.sessionId,
        startTime,
        endTime,
        device,
        app,
        schemaVersion: 1,
      },
      elements: [],
      events: [],
      screenshots: [],
    };

    // Build node map from full snapshots and mutations
    for (const event of sortedEvents) {
      if (event.type === RrwebEventType.FullSnapshot) {
        const data = event.data as FullSnapshotData;
        this.buildNodeMap(data.node);
      } else if (event.type === RrwebEventType.IncrementalSnapshot) {
        const data = event.data as IncrementalSnapshotData;
        if (data.source === IncrementalSource.Mutation && data.adds) {
          for (const add of data.adds) {
            this.buildNodeMap(add.node);
          }
        }
      }
    }

    // Convert events
    let previousTimestamp = startTime;

    for (const event of sortedEvents) {
      const gremlinEvents = this.convertEvent(event, session);

      for (const gremlinEvent of gremlinEvents) {
        const dt = event.timestamp - previousTimestamp;
        session.events.push({
          dt,
          ...gremlinEvent,
        });
        previousTimestamp = event.timestamp;
      }
    }

    return session;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }

  private buildNodeMap(node: SerializedNode): void {
    this.nodeMap.set(node.id, node);
    if (node.childNodes) {
      for (const child of node.childNodes) {
        this.buildNodeMap(child);
      }
    }
  }

  private convertEvent(
    event: RrwebEvent,
    session: GremlinSession
  ): Omit<GremlinEvent, 'dt'>[] {
    const events: Omit<GremlinEvent, 'dt'>[] = [];

    switch (event.type) {
      case RrwebEventType.Meta:
        events.push(...this.convertMetaEvent(event));
        break;

      case RrwebEventType.IncrementalSnapshot:
        events.push(...this.convertIncrementalEvent(event, session));
        break;

      // DomContentLoaded, Load, FullSnapshot, Custom events are not converted
      // as they don't represent user interactions
    }

    return events;
  }

  private convertMetaEvent(event: RrwebEvent): Omit<GremlinEvent, 'dt'>[] {
    const data = event.data as MetaData;

    return [
      {
        type: EventTypeEnum.NAVIGATION,
        data: {
          kind: 'navigation',
          navType: 'push',
          screen: data.href,
          url: data.href,
        } as NavigationEvent,
      },
    ];
  }

  private convertIncrementalEvent(
    event: RrwebEvent,
    session: GremlinSession
  ): Omit<GremlinEvent, 'dt'>[] {
    const data = event.data as IncrementalSnapshotData;
    const events: Omit<GremlinEvent, 'dt'>[] = [];

    switch (data.source) {
      case IncrementalSource.MouseInteraction:
        events.push(...this.convertMouseInteraction(data, session));
        break;

      case IncrementalSource.Scroll:
        events.push(...this.convertScroll(data, session));
        break;

      case IncrementalSource.Input:
        events.push(...this.convertInput(data, session));
        break;

      case IncrementalSource.Log:
        if (this.options.includeConsoleErrors) {
          events.push(...this.convertLog(data));
        }
        break;

      // Other sources (MouseMove, Mutation, ViewportResize, etc.) are not converted
      // as they're either not user actions or too granular for test generation
    }

    return events;
  }

  private convertMouseInteraction(
    data: IncrementalSnapshotData,
    session: GremlinSession
  ): Omit<GremlinEvent, 'dt'>[] {
    if (data.type === undefined || data.x === undefined || data.y === undefined) {
      return [];
    }

    const elementIndex = this.getOrCreateElement(data.id, session);

    switch (data.type) {
      case MouseInteractions.Click:
      case MouseInteractions.MouseUp:
        return [
          {
            type: EventTypeEnum.TAP,
            data: {
              kind: 'tap',
              x: data.x,
              y: data.y,
              elementIndex,
            } as TapEvent,
          },
        ];

      case MouseInteractions.DblClick:
        return [
          {
            type: EventTypeEnum.DOUBLE_TAP,
            data: {
              kind: 'double_tap',
              x: data.x,
              y: data.y,
              elementIndex,
            } as TapEvent,
          },
        ];

      case MouseInteractions.TouchEnd:
        return [
          {
            type: EventTypeEnum.TAP,
            data: {
              kind: 'tap',
              x: data.x,
              y: data.y,
              elementIndex,
            } as TapEvent,
          },
        ];

      default:
        // Ignore other interaction types (MouseDown, ContextMenu, Focus, Blur, etc.)
        return [];
    }
  }

  private convertScroll(
    data: IncrementalSnapshotData,
    session: GremlinSession
  ): Omit<GremlinEvent, 'dt'>[] {
    if (!data.scrollData) {
      return [];
    }

    const containerIndex = this.getOrCreateElement(data.scrollData.id, session);

    return [
      {
        type: EventTypeEnum.SCROLL,
        data: {
          kind: 'scroll',
          deltaX: data.scrollData.x,
          deltaY: data.scrollData.y,
          containerIndex,
        } as ScrollEvent,
      },
    ];
  }

  private convertInput(
    data: IncrementalSnapshotData,
    session: GremlinSession
  ): Omit<GremlinEvent, 'dt'>[] {
    if (data.text === undefined || data.id === undefined) {
      return [];
    }

    const elementIndex = this.getOrCreateElement(data.id, session);

    // Determine input type from element
    let inputType: InputEvent['inputType'] = 'text';
    if (elementIndex !== undefined) {
      const element = session.elements[elementIndex];
      const typeAttr = element.attributes?.['type'];
      if (typeAttr === 'password') inputType = 'password';
      else if (typeAttr === 'email') inputType = 'email';
      else if (typeAttr === 'number') inputType = 'number';
      else if (typeAttr === 'tel') inputType = 'phone';
    }

    return [
      {
        type: EventTypeEnum.INPUT,
        data: {
          kind: 'input',
          elementIndex,
          value: this.options.maskInputs && inputType === 'password' ? '***' : data.text,
          masked: this.options.maskInputs && inputType === 'password',
          inputType,
        } as InputEvent,
      },
    ];
  }

  private convertLog(
    data: IncrementalSnapshotData
  ): Omit<GremlinEvent, 'dt'>[] {
    if (!data.payload || typeof data.payload !== 'object') {
      return [];
    }

    const payload = data.payload as { level?: string; payload?: string[] };

    if (payload.level === 'error' && payload.payload) {
      return [
        {
          type: EventTypeEnum.ERROR,
          data: {
            kind: 'error',
            message: payload.payload.join(' '),
            errorType: 'js',
            fatal: false,
          } as ErrorEvent,
        },
      ];
    }

    return [];
  }

  private getOrCreateElement(
    nodeId: number | undefined,
    session: GremlinSession
  ): number | undefined {
    if (nodeId === undefined) return undefined;

    const node = this.nodeMap.get(nodeId);
    if (!node) return undefined;

    // Extract element info
    const elementInfo: ElementInfo = {
      type: this.getElementType(node),
      testId: node.attributes?.['data-testid'] || node.attributes?.['data-test'],
      accessibilityLabel:
        node.attributes?.['aria-label'] || node.attributes?.['aria-labelledby'],
      text: this.getTextContent(node),
      cssSelector: this.generateCssSelector(node),
      attributes: node.attributes,
    };

    // Check if element already exists
    const existingIndex = session.elements.findIndex(
      (e) =>
        e.testId === elementInfo.testId &&
        e.text === elementInfo.text &&
        e.type === elementInfo.type &&
        e.cssSelector === elementInfo.cssSelector
    );

    if (existingIndex !== -1) {
      return existingIndex;
    }

    // Add new element
    session.elements.push(elementInfo);
    return session.elements.length - 1;
  }

  private getElementType(node: SerializedNode): ElementInfo['type'] {
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

  private getTextContent(node: SerializedNode): string | undefined {
    if (node.textContent) {
      const text = node.textContent.trim();
      return text || undefined;
    }

    // Try accessibility labels
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

  private generateCssSelector(node: SerializedNode): string | undefined {
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
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Import rrweb recording from event array
 */
export function importRrwebRecording(
  events: RrwebEvent[],
  options?: RrwebImportOptions
): GremlinSession {
  const importer = new RrwebImporter(options);
  return importer.importRecording(events);
}

/**
 * Parse rrweb JSON file and import
 */
export function parseRrwebFile(
  json: string,
  options?: RrwebImportOptions
): GremlinSession {
  const events = JSON.parse(json) as RrwebEvent[];
  return importRrwebRecording(events, options);
}

/**
 * Create an rrweb importer instance
 */
export function createRrwebImporter(
  options?: RrwebImportOptions
): RrwebImporter {
  return new RrwebImporter(options);
}
