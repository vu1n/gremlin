/**
 * PostHog session recording importer
 *
 * Imports session recordings from PostHog and converts them to GremlinSession format.
 * PostHog uses rrweb internally for session recording, which we parse to extract
 * meaningful user interactions.
 */

import type {
  GremlinSession,
  GremlinEvent,
  ElementInfo,
  EventTypeEnum,
  DeviceInfo,
  AppInfo,
  TapEvent,
  ScrollEvent,
  InputEvent,
  NavigationEvent,
  ErrorEvent,
} from '../session/types';

// ============================================================================
// Configuration
// ============================================================================

export interface PostHogConfig {
  /** PostHog API key (personal API key or project API key) */
  apiKey: string;

  /** Project ID */
  projectId: string;

  /** Base URL (defaults to PostHog cloud) */
  baseUrl?: string;
}

export interface ListOptions {
  /** Limit number of recordings */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Filter by date range */
  dateFrom?: Date;
  dateTo?: Date;

  /** Filter by duration (seconds) */
  durationMin?: number;
  durationMax?: number;

  /** Filter by person/user ID */
  personId?: string;
}

// ============================================================================
// PostHog API Types
// ============================================================================

export interface RecordingList {
  results: RecordingMetadata[];
  next?: string;
  previous?: string;
  total_count?: number;
}

export interface RecordingMetadata {
  id: string;
  distinct_id: string;
  viewed: boolean;
  recording_duration: number;
  active_seconds?: number;
  inactive_seconds?: number;
  start_time: string;
  end_time: string;
  click_count?: number;
  keypress_count?: number;
  console_error_count?: number;
  console_warn_count?: number;
  console_log_count?: number;
}

export interface PostHogRecording {
  id: string;
  distinct_id: string;
  viewed: boolean;
  recording_duration: number;
  start_time: string;
  end_time: string;
  snapshot_data: RRWebEvent[];
  person?: {
    id: string;
    name?: string;
    properties?: Record<string, unknown>;
  };
  metadata?: RecordingMetadata;
}

// ============================================================================
// RRWeb Types (PostHog's internal format)
// ============================================================================

// Import rrweb types
import type {
  RrwebEvent,
  RrwebEventData,
  MetaData as RrwebMetaData,
  FullSnapshotData as RrwebFullSnapshotData,
  IncrementalSnapshotData as RrwebIncrementalSnapshotData,
  MousePosition as RrwebMousePosition,
  SerializedNode as RrwebSerializedNode,
  CustomEventData as RrwebCustomEventData,
} from './rrweb';

import {
  RrwebEventType,
  IncrementalSource as RrwebIncrementalSource,
  MouseInteractions,
} from './rrweb';

// Use type aliases internally for backward compatibility with PostHog code
// But don't export them to avoid conflicts with rrweb.ts exports
type RRWebEvent = RrwebEvent;
type RRWebEventData = RrwebEventData;
type MetaData = RrwebMetaData;
type FullSnapshotData = RrwebFullSnapshotData;
type IncrementalSnapshotData = RrwebIncrementalSnapshotData;
type MousePosition = RrwebMousePosition;
type SerializedNode = RrwebSerializedNode;

// ============================================================================
// PostHog Importer
// ============================================================================

export class PostHogImporter {
  private config: Required<PostHogConfig>;
  private nodeMap: Map<number, SerializedNode> = new Map();

  constructor(config: PostHogConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl || 'https://app.posthog.com',
    };
  }

  /**
   * List available session recordings
   */
  async listRecordings(options: ListOptions = {}): Promise<RecordingList> {
    const params = new URLSearchParams();

    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());
    if (options.dateFrom)
      params.append('date_from', options.dateFrom.toISOString());
    if (options.dateTo) params.append('date_to', options.dateTo.toISOString());
    if (options.durationMin)
      params.append('duration_min', options.durationMin.toString());
    if (options.durationMax)
      params.append('duration_max', options.durationMax.toString());
    if (options.personId) params.append('person_id', options.personId);

    const url = `${this.config.baseUrl}/api/projects/${this.config.projectId}/session_recordings/?${params}`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list recordings: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  }

  /**
   * Fetch a single recording with all snapshot data
   */
  async fetchRecording(recordingId: string): Promise<PostHogRecording> {
    const url = `${this.config.baseUrl}/api/projects/${this.config.projectId}/session_recordings/${recordingId}`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch recording: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Fetch snapshot data separately if not included
    if (!data.snapshot_data) {
      const snapshotUrl = `${url}/snapshots`;
      const snapshotResponse = await fetch(snapshotUrl, {
        headers: this.getHeaders(),
      });

      if (snapshotResponse.ok) {
        const snapshotData = await snapshotResponse.json();
        data.snapshot_data = snapshotData.snapshot_data || [];
      } else {
        data.snapshot_data = [];
      }
    }

    return data;
  }

  /**
   * Convert PostHog recording to GremlinSession format
   */
  convertToGremlinSession(recording: PostHogRecording): GremlinSession {
    // Reset node map for this recording
    this.nodeMap.clear();

    // Extract metadata from first events
    const metaEvent = recording.snapshot_data.find(
      (e) => e.type === 4 // RRWebEventType.Meta
    );
    const metaData = metaEvent?.data as MetaData | undefined;

    // Parse timestamps
    const startTime = new Date(recording.start_time).getTime();
    const endTime = new Date(recording.end_time).getTime();

    // Build device info
    const device: DeviceInfo = {
      platform: 'web',
      osVersion: 'unknown',
      screen: {
        width: metaData?.width || 1920,
        height: metaData?.height || 1080,
        pixelRatio: 1,
      },
      userAgent: recording.person?.properties?.['$browser'] as
        | string
        | undefined,
      locale: recording.person?.properties?.['$locale'] as string | undefined,
    };

    // Extract app info from URL
    const appUrl = metaData?.href || recording.person?.properties?.['$host'];
    const url = appUrl ? new URL(appUrl as string) : null;

    const app: AppInfo = {
      name: url?.hostname || 'unknown',
      version: '1.0.0',
      identifier: url?.origin || 'unknown',
    };

    // Create base session
    const session: GremlinSession = {
      header: {
        sessionId: recording.id,
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

    // Sort events by timestamp
    const sortedEvents = [...recording.snapshot_data].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    // Build node map from full snapshots
    for (const event of sortedEvents) {
      if (event.type === 2) { // RRWebEventType.FullSnapshot
        const data = event.data as FullSnapshotData;
        this.buildNodeMap(data.node);
      }
    }

    // Convert rrweb events to Gremlin events
    let previousTimestamp = startTime;

    for (const event of sortedEvents) {
      const gremlinEvents = this.convertRRWebEvent(event, session);

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
  // Private Helper Methods
  // ============================================================================

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private buildNodeMap(node: SerializedNode): void {
    this.nodeMap.set(node.id, node);
    if (node.childNodes) {
      for (const child of node.childNodes) {
        this.buildNodeMap(child);
      }
    }
  }

  private convertRRWebEvent(
    event: RRWebEvent,
    session: GremlinSession
  ): Omit<GremlinEvent, 'dt'>[] {
    const events: Omit<GremlinEvent, 'dt'>[] = [];

    switch (event.type) {
      case 4: { // RRWebEventType.Meta
        // Navigation event from meta
        const data = event.data as MetaData;
        events.push({
          type: 6 as EventTypeEnum, // NAVIGATION
          data: {
            kind: 'navigation',
            navType: 'push',
            screen: data.href,
            url: data.href,
          } as NavigationEvent,
        });
        break;
      }

      case 3: { // RRWebEventType.IncrementalSnapshot
        const data = event.data as IncrementalSnapshotData;

        switch (data.source) {
          case 2: // IncrementalSource.MouseInteraction
            if (
              data.type === 2 || // MouseInteractionType.Click
              data.type === 0 // MouseInteractionType.MouseUp
            ) {
              const elementIndex = this.getOrCreateElementFromNode(
                data.id,
                session
              );
              events.push({
                type: 0 as EventTypeEnum, // TAP
                data: {
                  kind: 'tap',
                  x: data.x || 0,
                  y: data.y || 0,
                  elementIndex,
                } as TapEvent,
              });
            } else if (data.type === 4) { // MouseInteractionType.DblClick
              const elementIndex = this.getOrCreateElementFromNode(
                data.id,
                session
              );
              events.push({
                type: 1 as EventTypeEnum, // DOUBLE_TAP
                data: {
                  kind: 'double_tap',
                  x: data.x || 0,
                  y: data.y || 0,
                  elementIndex,
                } as TapEvent,
              });
            }
            break;

          case 3: // IncrementalSource.Scroll
            if (data.scrollData) {
              const containerIndex = this.getOrCreateElementFromNode(
                data.scrollData.id,
                session
              );
              events.push({
                type: 4 as EventTypeEnum, // SCROLL
                data: {
                  kind: 'scroll',
                  deltaX: data.scrollData.x,
                  deltaY: data.scrollData.y,
                  containerIndex,
                } as ScrollEvent,
              });
            }
            break;

          case 5: // IncrementalSource.Input
            if (data.text !== undefined && data.id !== undefined) {
              const elementIndex = this.getOrCreateElementFromNode(
                data.id,
                session
              );
              events.push({
                type: 5 as EventTypeEnum, // INPUT
                data: {
                  kind: 'input',
                  elementIndex,
                  value: data.text,
                  masked: false, // PostHog may mask this already
                } as InputEvent,
              });
            }
            break;

          case 11: // IncrementalSource.Log
            // Console errors
            if (
              data.payload &&
              typeof data.payload === 'object' &&
              'level' in data.payload
            ) {
              const payload = data.payload as {
                level: string;
                payload: string[];
              };
              if (payload.level === 'error') {
                events.push({
                  type: 9 as EventTypeEnum, // ERROR
                  data: {
                    kind: 'error',
                    message: payload.payload.join(' '),
                    errorType: 'js',
                    fatal: false,
                  } as ErrorEvent,
                });
              }
            }
            break;
        }
        break;
      }
    }

    return events;
  }

  private getOrCreateElementFromNode(
    nodeId: number | undefined,
    session: GremlinSession
  ): number | undefined {
    if (nodeId === undefined) return undefined;

    const node = this.nodeMap.get(nodeId);
    if (!node) return undefined;

    // Extract element info from node
    const elementInfo: ElementInfo = {
      type: this.getElementType(node),
      testId: node.attributes?.['data-testid'] || node.attributes?.['data-test'],
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
        return 'image';
      case 'div':
      case 'section':
      case 'article':
        return 'container';
      case 'ul':
      case 'ol':
        return 'list';
      case 'li':
        return 'list_item';
      default:
        if (node.textContent) return 'text';
        return 'unknown';
    }
  }

  private getTextContent(node: SerializedNode): string | undefined {
    if (node.textContent) {
      return node.textContent.trim();
    }

    // For buttons/links, try to get text from attributes
    if (node.attributes?.['aria-label']) {
      return node.attributes['aria-label'];
    }

    if (node.attributes?.['title']) {
      return node.attributes['title'];
    }

    return undefined;
  }

  private generateCssSelector(node: SerializedNode): string | undefined {
    if (!node.tagName) return undefined;

    let selector = node.tagName.toLowerCase();

    // Add ID if present
    if (node.attributes?.['id']) {
      selector += `#${node.attributes['id']}`;
    }

    // Add classes if present
    if (node.attributes?.['class']) {
      const classes = node.attributes['class'].split(' ').filter(Boolean);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    return selector;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a PostHog importer instance
 */
export function createPostHogImporter(config: PostHogConfig): PostHogImporter {
  return new PostHogImporter(config);
}

/**
 * Import a single recording by ID
 */
export async function importRecording(
  config: PostHogConfig,
  recordingId: string
): Promise<GremlinSession> {
  const importer = new PostHogImporter(config);
  const recording = await importer.fetchRecording(recordingId);
  return importer.convertToGremlinSession(recording);
}

/**
 * Import multiple recordings with filters
 */
export async function importRecordings(
  config: PostHogConfig,
  options: ListOptions = {}
): Promise<GremlinSession[]> {
  const importer = new PostHogImporter(config);
  const recordingList = await importer.listRecordings(options);

  const sessions: GremlinSession[] = [];

  for (const metadata of recordingList.results) {
    const recording = await importer.fetchRecording(metadata.id);
    const session = importer.convertToGremlinSession(recording);
    sessions.push(session);
  }

  return sessions;
}
