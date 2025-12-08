/**
 * Example client for Gremlin API
 *
 * Demonstrates how to interact with the Gremlin server API
 */

import type { GremlinSession } from '@gremlin/session';
import type {
  SessionUploadResponse,
  SessionListResult,
  SessionSummary,
  SessionDeleteResponse,
} from '../src/types';

export class GremlinClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  /**
   * Upload a session to the server
   */
  async uploadSession(session: GremlinSession): Promise<SessionUploadResponse> {
    const response = await fetch(`${this.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(session),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Upload failed: ${error.error?.message || 'Unknown error'}`);
    }

    return response.json();
  }

  /**
   * Get a session by ID
   */
  async getSession(id: string): Promise<GremlinSession> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${id}`, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Get session failed: ${error.error?.message || 'Unknown error'}`);
    }

    return response.json();
  }

  /**
   * Get session metadata only (faster, smaller)
   */
  async getSessionMetadata(id: string): Promise<SessionSummary> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${id}?metadata=true`, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Get metadata failed: ${error.error?.message || 'Unknown error'}`);
    }

    return response.json();
  }

  /**
   * List sessions with pagination
   */
  async listSessions(limit: number = 20, cursor?: string): Promise<SessionListResult> {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = await fetch(`${this.baseUrl}/v1/sessions?${params}`, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`List sessions failed: ${error.error?.message || 'Unknown error'}`);
    }

    return response.json();
  }

  /**
   * Delete a session
   */
  async deleteSession(id: string): Promise<SessionDeleteResponse> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${id}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Delete session failed: ${error.error?.message || 'Unknown error'}`);
    }

    return response.json();
  }

  /**
   * Get all sessions (handles pagination automatically)
   */
  async *getAllSessions(limit: number = 50): AsyncGenerator<SessionSummary> {
    let cursor: string | undefined;

    do {
      const result = await this.listSessions(limit, cursor);

      for (const session of result.sessions) {
        yield session;
      }

      cursor = result.cursor;
    } while (cursor);
  }
}

// ============================================================================
// Example Usage
// ============================================================================

async function exampleUsage() {
  // Initialize client
  const client = new GremlinClient(
    'https://your-worker.workers.dev',
    'your-api-key'
  );

  // Create a sample session
  const session: GremlinSession = {
    header: {
      sessionId: 'example-session',
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: 'macOS 14',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
        userAgent: 'Mozilla/5.0...',
      },
      app: {
        name: 'My App',
        version: '1.0.0',
        identifier: 'https://example.com',
      },
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
  };

  try {
    // Upload session
    const uploadResult = await client.uploadSession(session);
    console.log('Uploaded session:', uploadResult.id);

    // Get session metadata
    const metadata = await client.getSessionMetadata(uploadResult.id);
    console.log('Session metadata:', metadata);

    // List all sessions
    const sessions = await client.listSessions(10);
    console.log(`Found ${sessions.sessions.length} sessions`);

    // Stream all sessions
    console.log('All sessions:');
    for await (const session of client.getAllSessions()) {
      console.log(`  - ${session.id} (${session.platform}, ${session.eventCount} events)`);
    }

    // Get full session
    const fullSession = await client.getSession(uploadResult.id);
    console.log('Full session:', fullSession.header);

    // Delete session
    const deleteResult = await client.deleteSession(uploadResult.id);
    console.log('Deleted:', deleteResult.deleted);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run example if this file is executed directly
if (import.meta.main) {
  exampleUsage();
}
