/**
 * Tests for Gremlin API
 *
 * Run with: bun test
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import type { GremlinSession } from '@gremlin/session';
import app from './index';

// Mock environment for testing
const mockEnv = {
  API_KEY: 'test-api-key',
  SESSIONS: {
    // Mock R2 bucket
    storage: new Map<string, { value: string; metadata: Record<string, string> }>(),

    async put(key: string, value: ArrayBuffer | string, options?: any) {
      const valueStr = typeof value === 'string' ? value : new TextDecoder().decode(value);
      this.storage.set(key, {
        value: valueStr,
        metadata: options?.customMetadata || {},
      });
    },

    async get(key: string) {
      const item = this.storage.get(key);
      if (!item) return null;

      return {
        text: async () => item.value,
        json: async () => JSON.parse(item.value),
        customMetadata: item.metadata,
      };
    },

    async head(key: string) {
      const item = this.storage.get(key);
      if (!item) return null;

      return {
        size: item.value.length,
        customMetadata: item.metadata,
      };
    },

    async list(options: any) {
      const prefix = options?.prefix || '';
      const limit = options?.limit || 1000;
      const objects = [];

      for (const [key, item] of this.storage.entries()) {
        if (key.startsWith(prefix)) {
          objects.push({
            key,
            size: item.value.length,
            customMetadata: item.metadata,
          });
        }
      }

      return {
        objects: objects.slice(0, limit),
        truncated: false,
      };
    },

    async delete(key: string) {
      this.storage.delete(key);
    },
  },
} as any;

// Helper to create a test session
function createTestSession(overrides?: Partial<GremlinSession>): GremlinSession {
  return {
    header: {
      sessionId: `test-${Date.now()}`,
      startTime: Date.now(),
      device: {
        platform: 'web',
        osVersion: 'macOS 14',
        screen: { width: 1920, height: 1080, pixelRatio: 2 },
      },
      app: {
        name: 'Test App',
        version: '1.0.0',
        identifier: 'https://test.com',
      },
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
    ...overrides,
  };
}

// Helper to make requests
async function makeRequest(
  path: string,
  options: RequestInit = {},
  includeAuth = true
) {
  const headers = new Headers(options.headers);

  // Only set default auth if includeAuth is true AND no X-API-Key header exists
  if (includeAuth && !headers.has('X-API-Key')) {
    headers.set('X-API-Key', mockEnv.API_KEY);
  }

  const request = new Request(`http://localhost${path}`, {
    ...options,
    headers,
  });

  return app.fetch(request, mockEnv);
}

describe('Gremlin API', () => {
  beforeAll(() => {
    // Clear storage before tests
    mockEnv.SESSIONS.storage.clear();
  });

  describe('Health Check', () => {
    test('GET / returns API info', async () => {
      const response = await makeRequest('/', {}, false);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.name).toBe('Gremlin API');
      expect(data.version).toBe('0.0.1');
      expect(data.endpoints).toBeDefined();
    });
  });

  describe('Authentication', () => {
    test('requires API key for protected endpoints', async () => {
      const response = await makeRequest('/v1/sessions', {}, false);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    test('rejects invalid API key', async () => {
      const response = await makeRequest('/v1/sessions', {
        headers: { 'X-API-Key': 'wrong-key' },
      });
      expect(response.status).toBe(403);

      const data = await response.json();
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Session Upload', () => {
    test('uploads a valid session', async () => {
      const session = createTestSession();

      const response = await makeRequest('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.uploadedAt).toBeDefined();
      expect(data.size).toBeGreaterThan(0);
    });

    test('rejects invalid session', async () => {
      const response = await makeRequest('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error.code).toBe('INVALID_SESSION');
      expect(data.error.details).toBeDefined();
    });

    test('rejects wrong content type', async () => {
      const response = await makeRequest('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error.code).toBe('INVALID_CONTENT_TYPE');
    });
  });

  describe('Session Retrieval', () => {
    test('retrieves a session by ID', async () => {
      // Upload a session first
      const session = createTestSession();
      const uploadResponse = await makeRequest('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
      const { id } = await uploadResponse.json();

      // Retrieve it
      const response = await makeRequest(`/v1/sessions/${id}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.header.sessionId).toBeDefined();
      expect(data.elements).toBeDefined();
      expect(data.events).toBeDefined();
    });

    test('retrieves session metadata only', async () => {
      // Upload a session first
      const session = createTestSession();
      const uploadResponse = await makeRequest('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
      const { id } = await uploadResponse.json();

      // Retrieve metadata
      const response = await makeRequest(`/v1/sessions/${id}?metadata=true`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBe(id);
      expect(data.platform).toBe('web');
      expect(data.eventCount).toBe(0);
    });

    test('returns 404 for non-existent session', async () => {
      const response = await makeRequest('/v1/sessions/nonexistent');
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Session Listing', () => {
    test('lists sessions', async () => {
      // Upload a few sessions
      for (let i = 0; i < 3; i++) {
        const session = createTestSession();
        await makeRequest('/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
        });
      }

      // List sessions
      const response = await makeRequest('/v1/sessions');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBeGreaterThan(0);
    });

    test('respects limit parameter', async () => {
      const response = await makeRequest('/v1/sessions?limit=1');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.sessions.length).toBeLessThanOrEqual(1);
    });

    test('rejects invalid limit', async () => {
      const response = await makeRequest('/v1/sessions?limit=invalid');
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('Session Deletion', () => {
    test('deletes a session', async () => {
      // Upload a session first
      const session = createTestSession();
      const uploadResponse = await makeRequest('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
      const { id } = await uploadResponse.json();

      // Delete it
      const response = await makeRequest(`/v1/sessions/${id}`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.deleted).toBe(true);
      expect(data.id).toBe(id);

      // Verify it's gone
      const getResponse = await makeRequest(`/v1/sessions/${id}`);
      expect(getResponse.status).toBe(404);
    });

    test('returns 404 when deleting non-existent session', async () => {
      const response = await makeRequest('/v1/sessions/nonexistent', {
        method: 'DELETE',
      });
      expect(response.status).toBe(404);
    });
  });

  describe('Error Handling', () => {
    test('returns 404 for unknown endpoints', async () => {
      const response = await makeRequest('/v1/unknown');
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });
});
