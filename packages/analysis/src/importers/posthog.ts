/**
 * PostHog session recording importer
 *
 * Imports session recordings from PostHog and converts them to GremlinSession format.
 * PostHog uses rrweb internally for session recording, which we parse to extract
 * meaningful user interactions.
 */

import {
  type GremlinSession,
  SCHEMA_VERSION,
} from '@gremlin/session';

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

// Import rrweb types from shared type definitions (not the importer)
import {
  RrwebEventType,
  MouseInteractions,
  type RrwebEvent,
  type MetaData,
} from './rrweb-types.ts';

import { importRrwebRecording } from './rrweb.ts';

// Type alias for internal use
type RRWebEvent = RrwebEvent;

// ============================================================================
// PostHog Importer
// ============================================================================

export class PostHogImporter {
  private config: Required<PostHogConfig>;

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
    // Extract PostHog-specific metadata
    const startTime = new Date(recording.start_time).getTime();
    const endTime = new Date(recording.end_time).getTime();

    // Build PostHog-specific device info from person properties
    const metaEvent = recording.snapshot_data.find(
      (e) => e.type === RrwebEventType.Meta
    );
    const metaData = metaEvent?.data as MetaData | undefined;

    const userAgent = recording.person?.properties?.['$browser'] as
      | string
      | undefined;
    const locale = recording.person?.properties?.['$locale'] as
      | string
      | undefined;

    // Extract app info from URL (PostHog may provide host via person properties)
    const appUrl = metaData?.href || recording.person?.properties?.['$host'];
    let appName: string | undefined;
    let appIdentifier: string | undefined;
    if (appUrl) {
      try {
        const raw = String(appUrl);
        const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
        appName = url.hostname;
        appIdentifier = url.origin;
      } catch {
        // Invalid URL — fall through to defaults
      }
    }

    // Handle empty recordings (importRrwebRecording throws on empty events)
    if (recording.snapshot_data.length === 0) {
      return {
        header: {
          sessionId: recording.id,
          startTime,
          endTime,
          device: {
            platform: 'web',
            osVersion: 'unknown',
            screen: { width: 1920, height: 1080, pixelRatio: 1 },
            userAgent,
            locale,
          },
          app: {
            name: appName || 'unknown',
            version: '1.0.0',
            identifier: appIdentifier || 'unknown',
          },
          schemaVersion: SCHEMA_VERSION,
        },
        elements: [],
        events: [],
        screenshots: [],
      };
    }

    // Delegate rrweb event conversion to shared importRrwebRecording
    // PostHog uses Click + MouseUp as taps and does not infer input types
    const session = importRrwebRecording(recording.snapshot_data, {
      sessionId: recording.id,
      device: { userAgent, locale },
      app: { name: appName, identifier: appIdentifier },
      maskInputs: false,
      includeConsoleErrors: true,
      inferInputType: false,
      tapInteractions: [MouseInteractions.Click, MouseInteractions.MouseUp],
    });

    // Override timestamps with PostHog's authoritative values
    session.header.startTime = startTime;
    session.header.endTime = endTime;

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

