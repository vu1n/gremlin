/**
 * Tests for CLI file I/O helpers (sessions.ts) and AI provider helpers (ai.ts)
 *
 * Covers:
 * - ensureDir: creates directories recursively, handles existing dirs
 * - loadSessions: loads JSON files, warns on invalid, supports since filter
 * - detectProvider: returns correct provider based on env vars
 * - getApiKey: returns correct key for each provider
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureDir, loadSessions } from '../commands/shared/sessions.ts';
import { detectProvider, getApiKey } from '../commands/shared/ai.ts';

// ============================================================================
// ensureDir
// ============================================================================

describe('ensureDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gremlin-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates a new directory', () => {
    const newDir = join(tempDir, 'new-dir');
    expect(existsSync(newDir)).toBe(false);

    ensureDir(newDir);

    expect(existsSync(newDir)).toBe(true);
  });

  test('creates directories recursively', () => {
    const deepDir = join(tempDir, 'a', 'b', 'c');
    expect(existsSync(deepDir)).toBe(false);

    ensureDir(deepDir);

    expect(existsSync(deepDir)).toBe(true);
  });

  test('handles already-existing directory without error', () => {
    const existing = join(tempDir, 'existing');
    mkdirSync(existing);
    expect(existsSync(existing)).toBe(true);

    // Should not throw
    ensureDir(existing);

    expect(existsSync(existing)).toBe(true);
  });

  test('is idempotent when called multiple times', () => {
    const dir = join(tempDir, 'idempotent');

    ensureDir(dir);
    ensureDir(dir);
    ensureDir(dir);

    expect(existsSync(dir)).toBe(true);
  });
});

// ============================================================================
// loadSessions
// ============================================================================

describe('loadSessions', () => {
  let tempDir: string;
  let warnOutput: string[];
  const origWarn = console.warn;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gremlin-sessions-'));
    warnOutput = [];
    console.warn = (...args: unknown[]) => {
      warnOutput.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.warn = origWarn;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('loads valid session JSON files', async () => {
    const session = {
      header: { sessionId: 'abc-123', startTime: Date.now(), schemaVersion: 1, device: {}, app: {} },
      elements: [],
      events: [],
      screenshots: [],
    };
    writeFileSync(join(tempDir, 'session1.json'), JSON.stringify(session));

    const result = await loadSessions(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].header.sessionId).toBe('abc-123');
  });

  test('loads multiple session files', async () => {
    for (let i = 0; i < 3; i++) {
      const session = {
        header: { sessionId: `session-${i}`, startTime: Date.now(), schemaVersion: 1, device: {}, app: {} },
        elements: [],
        events: [],
        screenshots: [],
      };
      writeFileSync(join(tempDir, `session-${i}.json`), JSON.stringify(session));
    }

    const result = await loadSessions(tempDir);

    expect(result).toHaveLength(3);
  });

  test('ignores non-JSON files', async () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'not a session');
    writeFileSync(join(tempDir, 'data.csv'), 'col1,col2');
    const session = {
      header: { sessionId: 'only-one', startTime: Date.now(), schemaVersion: 1, device: {}, app: {} },
      elements: [],
      events: [],
      screenshots: [],
    };
    writeFileSync(join(tempDir, 'valid.json'), JSON.stringify(session));

    const result = await loadSessions(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].header.sessionId).toBe('only-one');
  });

  test('warns on invalid JSON files instead of throwing', async () => {
    writeFileSync(join(tempDir, 'bad.json'), '{invalid json!!!');

    const result = await loadSessions(tempDir);

    expect(result).toHaveLength(0);
    expect(warnOutput.length).toBeGreaterThanOrEqual(1);
    expect(warnOutput[0]).toContain('Warning');
    expect(warnOutput[0]).toContain('bad.json');
  });

  test('supports since filter - excludes older sessions', async () => {
    const oldSession = {
      header: { sessionId: 'old', startTime: new Date('2024-01-01').getTime(), schemaVersion: 1, device: {}, app: {} },
      elements: [],
      events: [],
      screenshots: [],
    };
    const newSession = {
      header: { sessionId: 'new', startTime: new Date('2025-06-01').getTime(), schemaVersion: 1, device: {}, app: {} },
      elements: [],
      events: [],
      screenshots: [],
    };
    writeFileSync(join(tempDir, 'old.json'), JSON.stringify(oldSession));
    writeFileSync(join(tempDir, 'new.json'), JSON.stringify(newSession));

    const result = await loadSessions(tempDir, { since: '2025-01-01' });

    expect(result).toHaveLength(1);
    expect(result[0].header.sessionId).toBe('new');
  });

  test('returns all sessions when since is not provided', async () => {
    const session1 = {
      header: { sessionId: 's1', startTime: new Date('2024-01-01').getTime(), schemaVersion: 1, device: {}, app: {} },
      elements: [],
      events: [],
      screenshots: [],
    };
    const session2 = {
      header: { sessionId: 's2', startTime: new Date('2025-06-01').getTime(), schemaVersion: 1, device: {}, app: {} },
      elements: [],
      events: [],
      screenshots: [],
    };
    writeFileSync(join(tempDir, 's1.json'), JSON.stringify(session1));
    writeFileSync(join(tempDir, 's2.json'), JSON.stringify(session2));

    const result = await loadSessions(tempDir);

    expect(result).toHaveLength(2);
  });

  test('returns empty array for empty directory', async () => {
    const result = await loadSessions(tempDir);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// detectProvider
// ============================================================================

describe('detectProvider', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = origEnv.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = origEnv.GEMINI_API_KEY;
  });

  test('returns "anthropic" when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(detectProvider()).toBe('anthropic');
  });

  test('returns "openai" when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    expect(detectProvider()).toBe('openai');
  });

  test('returns "gemini" when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    expect(detectProvider()).toBe('gemini');
  });

  test('returns undefined when no API keys are set', () => {
    expect(detectProvider()).toBeUndefined();
  });

  test('prefers anthropic over openai when both are set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    expect(detectProvider()).toBe('anthropic');
  });

  test('prefers anthropic over gemini when both are set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    expect(detectProvider()).toBe('anthropic');
  });

  test('prefers openai over gemini when both are set (no anthropic)', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    expect(detectProvider()).toBe('openai');
  });
});

// ============================================================================
// getApiKey
// ============================================================================

describe('getApiKey', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = origEnv.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = origEnv.GEMINI_API_KEY;
  });

  test('returns anthropic key when provider is "anthropic"', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-real-key';
    expect(getApiKey('anthropic')).toBe('sk-ant-real-key');
  });

  test('returns openai key when provider is "openai"', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-real-key';
    expect(getApiKey('openai')).toBe('sk-openai-real-key');
  });

  test('returns gemini key when provider is "gemini"', () => {
    process.env.GEMINI_API_KEY = 'gemini-real-key';
    expect(getApiKey('gemini')).toBe('gemini-real-key');
  });

  test('returns undefined when the requested provider key is not set', () => {
    expect(getApiKey('anthropic')).toBeUndefined();
    expect(getApiKey('openai')).toBeUndefined();
    expect(getApiKey('gemini')).toBeUndefined();
  });
});
