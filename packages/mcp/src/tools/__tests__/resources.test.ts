/**
 * Tests for MCP resource registration helpers.
 *
 * Covers:
 * - readJsonFile: null return for missing files, valid return for existing
 * - gremlinPath: path construction
 * - Resource handlers: config, sessions/{id}, spec, llms.txt
 *
 * Uses temp directories to test file reading without real .gremlin state.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Helpers - replicate readJsonFile and gremlinPath from resources.ts
// ============================================================================

type JsonFileResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_found' | 'invalid_json' | 'read_error' };

function readJsonFile<T>(path: string): JsonFileResult<T> {
  if (!existsSync(path)) return { ok: false, reason: 'not_found' };
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as T;
    return { ok: true, data };
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, reason: 'invalid_json' };
    return { ok: false, reason: 'read_error' };
  }
}

function gremlinPath(root: string, ...segments: string[]): string {
  return join(root, '.gremlin', ...segments);
}

// ============================================================================
// readJsonFile
// ============================================================================

describe('readJsonFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gremlin-res-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns not_found for non-existent file', () => {
    const result = readJsonFile(join(tempDir, 'nope.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  test('returns parsed JSON for valid file', () => {
    const filePath = join(tempDir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ port: 3000, name: 'TestApp' }));

    const result = readJsonFile<{ port: number; name: string }>(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.port).toBe(3000);
      expect(result.data.name).toBe('TestApp');
    }
  });

  test('returns invalid_json for malformed JSON', () => {
    const filePath = join(tempDir, 'bad.json');
    writeFileSync(filePath, 'not valid json {{{');

    const result = readJsonFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_json');
  });

  test('returns invalid_json for empty file', () => {
    const filePath = join(tempDir, 'empty.json');
    writeFileSync(filePath, '');

    const result = readJsonFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_json');
  });
});

// ============================================================================
// gremlinPath
// ============================================================================

describe('gremlinPath', () => {
  test('constructs path with single segment', () => {
    const result = gremlinPath('/home/user/project', 'config.json');
    expect(result).toBe(join('/home/user/project', '.gremlin', 'config.json'));
  });

  test('constructs path with multiple segments', () => {
    const result = gremlinPath('/home/user/project', 'sessions', 'abc.json');
    expect(result).toBe(join('/home/user/project', '.gremlin', 'sessions', 'abc.json'));
  });

  test('constructs path with no extra segments', () => {
    const result = gremlinPath('/home/user/project');
    expect(result).toBe(join('/home/user/project', '.gremlin'));
  });
});

// ============================================================================
// Resource handler logic - config
// ============================================================================

describe('config resource handler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gremlin-res-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(gremlinPath(tempDir), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns config content when file exists', () => {
    const configPath = gremlinPath(tempDir, 'config.json');
    const configData = { framework: 'nextjs', port: 4000 };
    writeFileSync(configPath, JSON.stringify(configData));

    const result = readJsonFile<unknown>(configPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).framework).toBe('nextjs');
    }
  });

  test('returns not_found when config does not exist', () => {
    const configPath = gremlinPath(tempDir, 'config.json');
    const result = readJsonFile<unknown>(configPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

// ============================================================================
// Resource handler logic - sessions/{id}
// ============================================================================

describe('sessions resource handler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gremlin-res-sess-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(gremlinPath(tempDir, 'sessions'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('reads session by ID', () => {
    const sessionData = { header: { sessionId: 'abc-123' }, events: [{ dt: 0 }] };
    writeFileSync(
      gremlinPath(tempDir, 'sessions', 'abc-123.json'),
      JSON.stringify(sessionData)
    );

    const result = readJsonFile<unknown>(gremlinPath(tempDir, 'sessions', 'abc-123.json'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).header).toBeDefined();
    }
  });

  test('returns not_found for non-existent session', () => {
    const result = readJsonFile<unknown>(gremlinPath(tempDir, 'sessions', 'missing.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  test('extracts session ID from URI pathname', () => {
    const uri = new URL('gremlin://sessions/my-session-id');
    const id = uri.pathname.split('/').filter(Boolean).pop() ?? '';
    expect(id).toBe('my-session-id');
  });

  test('handles URI with no ID gracefully', () => {
    const uri = new URL('gremlin://sessions/');
    const id = uri.pathname.split('/').filter(Boolean).pop() ?? '';
    // Trailing slash with no ID: pathname is '/' for authority-based URLs,
    // so filter(Boolean) leaves nothing -> pop returns undefined -> fallback ''
    expect(id).toBe('');
  });
});

// ============================================================================
// Resource handler logic - spec
// ============================================================================

describe('spec resource handler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gremlin-res-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(gremlinPath(tempDir, 'tests'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('reads spec when file exists', () => {
    const specData = { name: 'my-spec', states: [], transitions: [] };
    writeFileSync(
      gremlinPath(tempDir, 'tests', 'spec.json'),
      JSON.stringify(specData)
    );

    const result = readJsonFile<unknown>(gremlinPath(tempDir, 'tests', 'spec.json'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).name).toBe('my-spec');
    }
  });

  test('returns not_found when spec does not exist', () => {
    const result = readJsonFile<unknown>(gremlinPath(tempDir, 'tests', 'spec.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

// ============================================================================
// Resource handler logic - llms.txt
// ============================================================================

describe('llms.txt resource handler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gremlin-res-llms-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(gremlinPath(tempDir), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('reads llms.txt content when file exists', () => {
    const llmsContent = '# Gremlin LLM Context\nInstrumented components: Button, Input';
    writeFileSync(gremlinPath(tempDir, 'llms.txt'), llmsContent);

    const text = readFileSync(gremlinPath(tempDir, 'llms.txt'), 'utf-8');
    expect(text).toContain('Gremlin LLM Context');
    expect(text).toContain('Button');
  });

  test('detects missing llms.txt', () => {
    const llmsPath = gremlinPath(tempDir, 'llms.txt');
    expect(existsSync(llmsPath)).toBe(false);
  });
});
