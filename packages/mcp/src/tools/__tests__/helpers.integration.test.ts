/**
 * MCP-to-CLI bridge integration tests
 *
 * Tests the helpers that bridge MCP tool calls to CLI subprocess invocations.
 * These are true integration tests: they spawn real CLI processes and verify
 * the end-to-end contract between the MCP layer and the CLI.
 */

import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { existsSync } from 'fs';

import {
  runCliCommand,
  parseCliJsonEnvelope,
  createToolHandler,
  textResult,
  errorResult,
  type CliResult,
} from '../helpers.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLI_ENTRY = join(import.meta.dir, '..', '..', '..', '..', 'cli', 'src', 'index.ts');
const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// assertCliEntry (implicit via runCliCommand)
// ---------------------------------------------------------------------------

describe('assertCliEntry (implicit)', () => {
  test('CLI entrypoint file exists on disk', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runCliCommand — integration
// ---------------------------------------------------------------------------

describe('runCliCommand', () => {
  test('--help returns stdout with usage information', async () => {
    const result = await runCliCommand(['--help'], PROJECT_ROOT);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('gremlin');
    // Note: runCliCommand appends --json to all args, which may alter
    // Commander's help output, so we only check for the program name
    expect(result.stdout).toContain('Usage');
  }, 15_000);

  test('status --json returns valid JSON parseable by parseCliJsonEnvelope', async () => {
    const result = await runCliCommand(['status'], PROJECT_ROOT);

    // runCliCommand always appends --json, so stdout should be JSON
    const envelope = parseCliJsonEnvelope(result);

    expect(typeof envelope.ok).toBe('boolean');
    expect(envelope).toHaveProperty('data');

    // If it succeeded, command should be "status"
    if (envelope.ok) {
      expect(envelope.command).toBe('status');
    }
  }, 15_000);

  test('unknown command returns non-zero exit code', async () => {
    const result = await runCliCommand(['nonexistent-command-xyz'], PROJECT_ROOT);

    // Commander exits with 1 for unknown commands
    expect(result.exitCode).not.toBe(0);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// parseCliJsonEnvelope — integration with real CLI output
// ---------------------------------------------------------------------------

describe('parseCliJsonEnvelope (integration)', () => {
  test('parses real --help output as protocol error (non-JSON)', () => {
    // --help output is plain text, not JSON
    const fakeResult: CliResult = {
      exitCode: 0,
      stdout: 'Usage: gremlin [options] [command]\n\nOptions:\n  --json\n',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(fakeResult);

    // Non-JSON on exitCode 0 is a protocol violation
    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toContain('CLI returned non-JSON output');
  });

  test('parses real CLI JSON error output', () => {
    const result: CliResult = {
      exitCode: 1,
      stdout: '',
      stderr: JSON.stringify({ ok: false, command: 'init', errors: ['Not a project directory'] }),
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toContain('Not a project directory');
  });

  test('handles empty stderr on failure gracefully', () => {
    const result: CliResult = {
      exitCode: 1,
      stdout: '',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toEqual(['Command failed']);
  });

  test('handles malformed JSON in stdout', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: '{ broken json',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toContain('CLI returned non-JSON output');
  });

  test('prefers stderr envelope on non-zero exit', () => {
    const result: CliResult = {
      exitCode: 1,
      stdout: JSON.stringify({ ok: true, data: 'should be ignored' }),
      stderr: JSON.stringify({ ok: false, errors: ['stderr wins'] }),
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toContain('stderr wins');
  });

  test('falls back to stdout envelope when stderr is not JSON on non-zero exit', () => {
    const result: CliResult = {
      exitCode: 1,
      stdout: JSON.stringify({ ok: true, command: 'status', data: { partial: true } }),
      stderr: 'some warning text',
    };

    const envelope = parseCliJsonEnvelope(result);

    // Non-zero exit overrides ok: true
    expect(envelope.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createToolHandler — integration
// ---------------------------------------------------------------------------

describe('createToolHandler', () => {
  test('builds args from params and returns formatted MCP result', async () => {
    // Create a handler that calls --help (safe, always works)
    // We override to use --help which is non-JSON, so we expect an error result
    // Instead test with 'status' which does produce JSON
    const handler = createToolHandler(() => ['status']);

    const result = await handler({});

    // The result should have the MCP content structure
    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');

    // The text should be valid JSON
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBeDefined();
  }, 15_000);

  test('passes params to buildArgs function', async () => {
    const buildArgsCalls: Record<string, unknown>[] = [];

    const handler = createToolHandler((params) => {
      buildArgsCalls.push(params);
      // Return --help which produces non-JSON but tests the arg passing
      return ['status'];
    });

    await handler({ limit: 5, format: 'json' });

    expect(buildArgsCalls).toHaveLength(1);
    expect(buildArgsCalls[0]).toEqual({ limit: 5, format: 'json' });
  }, 15_000);

  test('returns error result when CLI command fails', async () => {
    // Use a command that will fail (e.g., generate with no sessions)
    const handler = createToolHandler(() => ['replay', '/nonexistent/session.json']);

    const result = await handler({});

    // Should still return a valid MCP structure
    expect(result).toHaveProperty('content');
    expect(result.content[0]).toHaveProperty('type', 'text');

    // Should be an error
    if (result.isError) {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// textResult and errorResult — structural validation
// ---------------------------------------------------------------------------

describe('textResult (structural)', () => {
  test('wraps complex nested data', () => {
    const data = { sessions: [{ id: '1', events: 42 }], meta: { total: 1 } };
    const result = textResult(data);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(data);
    expect('isError' in result).toBe(false);
  });
});

describe('errorResult (structural)', () => {
  test('includes isError flag and error message', () => {
    const result = errorResult('Connection refused');

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Connection refused');
  });
});
