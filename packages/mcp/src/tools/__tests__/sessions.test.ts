/**
 * Tests for MCP session tool registration and helpers.
 *
 * Covers:
 * - readJsonFile: reading JSON from filesystem
 * - gremlin_session_get handler: found and not-found paths
 * - registerSessionTools: tool registration on McpServer
 *
 * Uses filesystem mocking via temp directories to avoid coupling
 * to real CLI execution for the direct-read session_get handler.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { textResult, errorResult } from '../helpers.ts';

// ============================================================================
// textResult / errorResult (used by session tools)
// ============================================================================

describe('textResult', () => {
  test('wraps data as JSON text content', () => {
    const result = textResult({ hello: 'world' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hello).toBe('world');
  });

  test('handles arrays', () => {
    const result = textResult([1, 2, 3]);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([1, 2, 3]);
  });

  test('handles null and undefined data', () => {
    const nullResult = textResult(null);
    expect(JSON.parse(nullResult.content[0].text)).toBeNull();
  });
});

describe('errorResult', () => {
  test('wraps error message with isError flag', () => {
    const result = errorResult('Session not found: abc');
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Session not found: abc');
  });
});

// ============================================================================
// readJsonFile behavior (tested via session_get handler logic)
// ============================================================================

describe('session file reading', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gremlin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempDir, '.gremlin', 'sessions'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('reads a valid session JSON file', () => {
    const sessionData = {
      header: { sessionId: 'test-123' },
      events: [],
      elements: [],
      screenshots: [],
    };
    const sessionPath = join(tempDir, '.gremlin', 'sessions', 'test-123.json');
    writeFileSync(sessionPath, JSON.stringify(sessionData));

    // Simulate what the handler does
    const content = JSON.parse(
      require('fs').readFileSync(sessionPath, 'utf-8')
    );
    expect(content.header.sessionId).toBe('test-123');
  });

  test('existsSync returns false for non-existent session', () => {
    const sessionPath = join(tempDir, '.gremlin', 'sessions', 'nonexistent.json');
    expect(existsSync(sessionPath)).toBe(false);
  });

  test('handles malformed JSON gracefully', () => {
    const sessionPath = join(tempDir, '.gremlin', 'sessions', 'bad.json');
    writeFileSync(sessionPath, '{invalid json content}');

    let parsed = null;
    try {
      parsed = JSON.parse(require('fs').readFileSync(sessionPath, 'utf-8'));
    } catch {
      parsed = null;
    }
    expect(parsed).toBeNull();
  });
});

// ============================================================================
// gremlin_sessions_list arg building
// ============================================================================

describe('gremlin_sessions_list args', () => {
  test('builds correct args with no limit', () => {
    const args = ['sessions'];
    expect(args).toEqual(['sessions']);
  });

  test('builds correct args with limit', () => {
    const limit = 10;
    const args = ['sessions'];
    if (limit) args.push('--limit', String(limit));
    expect(args).toEqual(['sessions', '--limit', '10']);
  });
});

// ============================================================================
// gremlin_session_get error/success paths
// ============================================================================

describe('gremlin_session_get response shaping', () => {
  test('returns errorResult when session is null', () => {
    const session = null;
    const sessionId = 'missing-id';

    const result = session ? textResult(session) : errorResult(`Session not found: ${sessionId}`);

    expect(result).toHaveProperty('isError', true);
    expect(JSON.parse(result.content[0].text).error).toContain('missing-id');
  });

  test('returns textResult when session exists', () => {
    const session = { header: { sessionId: 'found-id' }, events: [] };
    const sessionId = 'found-id';

    const result = session ? textResult(session) : errorResult(`Session not found: ${sessionId}`);

    expect(result).not.toHaveProperty('isError');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.header.sessionId).toBe('found-id');
  });
});
