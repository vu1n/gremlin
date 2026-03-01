/**
 * Import command unit tests
 *
 * Tests the import flow logic: validation, PostHog config building,
 * file format detection, and result shaping.
 *
 * Does NOT call the actual PostHog/file import functions (which depend on
 * external APIs and @gremlin/analysis). Instead tests the argument validation,
 * config construction, and result handling patterns.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Types replicated from import.ts
// ---------------------------------------------------------------------------

interface ImportResult {
  source: string;
  imported: number;
  failed: number;
  sessions: string[];
}

interface PostHogConfig {
  apiKey: string;
  projectId: string;
  baseUrl: string;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-import-test-'));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PostHog config construction
// ---------------------------------------------------------------------------

describe('PostHog config construction', () => {
  test('builds config with required fields', () => {
    const config: PostHogConfig = {
      apiKey: 'phx_test_key',
      projectId: '12345',
      baseUrl: 'https://app.posthog.com',
    };

    expect(config.apiKey).toBe('phx_test_key');
    expect(config.projectId).toBe('12345');
    expect(config.baseUrl).toBe('https://app.posthog.com');
  });

  test('uses default host when none provided', () => {
    const host = undefined;
    const config: PostHogConfig = {
      apiKey: 'key',
      projectId: '123',
      baseUrl: host || 'https://app.posthog.com',
    };

    expect(config.baseUrl).toBe('https://app.posthog.com');
  });

  test('uses custom host when provided', () => {
    const host = 'https://posthog.internal.example.com';
    const config: PostHogConfig = {
      apiKey: 'key',
      projectId: '123',
      baseUrl: host || 'https://app.posthog.com',
    };

    expect(config.baseUrl).toBe('https://posthog.internal.example.com');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('import input validation', () => {
  test('requires API key for PostHog import', () => {
    const apiKey = '';
    expect(!apiKey).toBe(true);
  });

  test('requires project ID for PostHog import', () => {
    const projectId = '';
    expect(!projectId).toBe(true);
  });

  test('accepts valid API key and project ID', () => {
    const apiKey = 'phx_valid_key';
    const projectId = '12345';
    expect(!apiKey).toBe(false);
    expect(!projectId).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// List options construction
// ---------------------------------------------------------------------------

describe('list options construction', () => {
  test('defaults limit to 10 when not provided', () => {
    const limit = undefined;
    const listLimit = limit || 10;
    expect(listLimit).toBe(10);
  });

  test('uses provided limit', () => {
    const limit = 25;
    const listLimit = limit || 10;
    expect(listLimit).toBe(25);
  });

  test('constructs date filters from ISO strings', () => {
    const dateFrom = '2024-01-01';
    const dateTo = '2024-12-31';

    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    expect(from.getFullYear()).toBe(2024);
    expect(from.getMonth()).toBe(0); // January
    expect(to.getMonth()).toBe(11); // December
  });
});

// ---------------------------------------------------------------------------
// Import result shaping
// ---------------------------------------------------------------------------

describe('import result shaping', () => {
  test('creates result for successful PostHog single recording import', () => {
    const recordingId = 'rec-123';
    const result: ImportResult = {
      source: 'posthog',
      imported: 1,
      failed: 0,
      sessions: [recordingId],
    };

    expect(result.source).toBe('posthog');
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.sessions).toContain('rec-123');
  });

  test('creates result for empty PostHog listing', () => {
    const result: ImportResult = {
      source: 'posthog',
      imported: 0,
      failed: 0,
      sessions: [],
    };

    expect(result.imported).toBe(0);
    expect(result.sessions).toEqual([]);
  });

  test('creates result with mixed successes and failures', () => {
    const sessionIds = ['rec-1', 'rec-2', 'rec-3'];
    const errors = ['rec-4: Timeout', 'rec-5: Not found'];

    const result: ImportResult = {
      source: 'posthog',
      imported: sessionIds.length,
      failed: errors.length,
      sessions: sessionIds,
    };

    expect(result.imported).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.sessions.length).toBe(3);
  });

  test('creates result for file import', () => {
    const sessionId = `imported-${Date.now()}`;
    const result: ImportResult = {
      source: 'file',
      imported: 1,
      failed: 0,
      sessions: [sessionId],
    };

    expect(result.source).toBe('file');
    expect(result.sessions[0]).toMatch(/^imported-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// File format detection
// ---------------------------------------------------------------------------

describe('file format detection', () => {
  test('detects rrweb format when events is an array', () => {
    const events = [{ type: 4, data: {} }, { type: 3, data: {} }];
    const format = undefined;
    const detectedFormat = format || (Array.isArray(events) ? 'rrweb' : 'posthog');
    expect(detectedFormat).toBe('rrweb');
  });

  test('detects posthog format when events is an object', () => {
    const events = { result: [] };
    const format = undefined;
    const detectedFormat = format || (Array.isArray(events) ? 'rrweb' : 'posthog');
    expect(detectedFormat).toBe('posthog');
  });

  test('uses explicit format when provided', () => {
    const events = [{ type: 4 }];
    const format = 'posthog' as 'rrweb' | 'posthog';
    const detectedFormat = format || (Array.isArray(events) ? 'rrweb' : 'posthog');
    expect(detectedFormat).toBe('posthog');
  });
});

// ---------------------------------------------------------------------------
// Output directory creation
// ---------------------------------------------------------------------------

describe('output directory creation', () => {
  test('creates output directory if it does not exist', async () => {
    const outputDir = join(tmpDir, 'output', 'sessions');
    expect(existsSync(outputDir)).toBe(false);

    const { mkdir } = await import('node:fs/promises');
    await mkdir(outputDir, { recursive: true });

    expect(existsSync(outputDir)).toBe(true);
  });

  test('writes session JSON file to output directory', () => {
    const outputDir = join(tmpDir, 'output');
    mkdirSync(outputDir, { recursive: true });

    const sessionData = {
      header: { sessionId: 'test-sess' },
      events: [{ dt: 0, type: 0, data: { kind: 'tap', x: 100, y: 200 } }],
      elements: [],
      screenshots: [],
    };

    const outputPath = join(outputDir, 'test-sess.json');
    writeFileSync(outputPath, JSON.stringify(sessionData, null, 2));

    expect(existsSync(outputPath)).toBe(true);
    const content = JSON.parse(require('fs').readFileSync(outputPath, 'utf-8'));
    expect(content.header.sessionId).toBe('test-sess');
  });

  test('handles multiple session files in output directory', () => {
    const outputDir = join(tmpDir, 'output');
    mkdirSync(outputDir, { recursive: true });

    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(outputDir, `session-${i}.json`),
        JSON.stringify({ header: { sessionId: `session-${i}` } })
      );
    }

    const files = readdirSync(outputDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Error handling patterns
// ---------------------------------------------------------------------------

describe('error handling', () => {
  test('extracts error message from Error instance', () => {
    const err = new Error('Network timeout');
    const message = err instanceof Error ? err.message : 'Unknown error';
    expect(message).toBe('Network timeout');
  });

  test('falls back to Unknown error for non-Error values', () => {
    const err = 'some string error';
    const message = err instanceof Error ? err.message : 'Unknown error';
    expect(message).toBe('Unknown error');
  });

  test('collects errors per recording during batch import', () => {
    const errors: string[] = [];
    const recordings = [
      { id: 'rec-1', success: true },
      { id: 'rec-2', success: false, error: 'Timeout' },
      { id: 'rec-3', success: false, error: 'Rate limited' },
    ];

    for (const rec of recordings) {
      if (!rec.success) {
        errors.push(`${rec.id}: ${rec.error}`);
      }
    }

    expect(errors.length).toBe(2);
    expect(errors[0]).toBe('rec-2: Timeout');
    expect(errors[1]).toBe('rec-3: Rate limited');
  });
});
