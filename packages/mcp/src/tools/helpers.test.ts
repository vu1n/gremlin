import { describe, test, expect } from 'bun:test';
import {
  parseCliJsonEnvelope,
  textResult,
  errorResult,
  parseRawCliOutput,
  type CliResult,
} from './helpers.ts';

// ============================================================================
// parseCliJsonEnvelope
// ============================================================================

describe('parseCliJsonEnvelope', () => {
  test('parses success envelope with ok: true', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, command: 'status', data: { sessions: 3 } }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('status');
    expect(envelope.data).toEqual({ sessions: 3 });
    expect(envelope.errors).toBeUndefined();
  });

  test('parses error envelope with ok: false and errors array', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: false,
        command: 'deploy',
        data: null,
        errors: ['Port in use', 'Config missing'],
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('deploy');
    // Note: parsed.data is null, so `null ?? parsed` falls through to the full object
    expect(envelope.data).toMatchObject({ ok: false, command: 'deploy' });
    expect(envelope.errors).toEqual(['Port in use', 'Config missing']);
  });

  test('parses error envelope with explicit data value', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: false,
        command: 'import',
        data: { partial: true },
        errors: ['Incomplete data'],
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.data).toEqual({ partial: true });
    expect(envelope.errors).toEqual(['Incomplete data']);
  });

  test('returns error envelope for non-zero exit code', () => {
    const result: CliResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'ENOENT: file not found',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.data).toBeNull();
    expect(envelope.errors).toEqual(['ENOENT: file not found']);
  });

  test('uses fallback error message when stderr is empty on non-zero exit', () => {
    const result: CliResult = {
      exitCode: 127,
      stdout: '',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.data).toBeNull();
    expect(envelope.errors).toEqual(['Command failed']);
  });

  test('treats non-JSON stdout on exitCode 0 as protocol error', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: 'Some plain text output\nwith newlines',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.data).toBeNull();
    expect(envelope.errors).toEqual(['CLI returned non-JSON output']);
    expect(envelope.meta).toEqual({ rawOutput: 'Some plain text output\nwith newlines' });
  });

  test('handles valid JSON that is not an envelope object', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify([1, 2, 3]),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    // Array does have 'ok' check fail (arrays are objects but don't have 'ok')
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual([1, 2, 3]);
  });

  test('handles JSON object without ok field', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({ version: '1.0', name: 'gremlin' }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ version: '1.0', name: 'gremlin' });
  });

  test('uses data field from envelope when present', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, data: { count: 42 }, extra: 'ignored' }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.data).toEqual({ count: 42 });
  });

  test('falls back to entire parsed object when data is missing in ok envelope', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, command: 'status' }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    // data ?? parsed => parsed object itself
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ ok: true, command: 'status' });
  });

  test('handles error envelope with no errors array (unknown error)', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({ ok: false }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toEqual(['Unknown CLI error']);
  });

  test('preserves warnings and meta from CLI envelope', () => {
    const result: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        command: 'init',
        data: { configured: true },
        warnings: ['Config already exists'],
        meta: { elapsed: 42 },
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(result);

    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('init');
    expect(envelope.warnings).toEqual(['Config already exists']);
    expect(envelope.meta).toEqual({ elapsed: 42 });
  });
});

// ============================================================================
// textResult
// ============================================================================

describe('textResult', () => {
  test('wraps data in MCP content structure', () => {
    const result = textResult({ sessions: 5, active: true });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ sessions: 5, active: true });
  });

  test('pretty-prints JSON with 2-space indentation', () => {
    const result = textResult({ a: 1 });

    expect(result.content[0].text).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  test('handles null data', () => {
    const result = textResult(null);
    expect(JSON.parse(result.content[0].text)).toBeNull();
  });

  test('handles array data', () => {
    const result = textResult([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  test('does not include isError property', () => {
    const result = textResult({ ok: true });
    expect('isError' in result).toBe(false);
  });
});

// ============================================================================
// errorResult
// ============================================================================

describe('errorResult', () => {
  test('wraps error message in MCP content structure with isError flag', () => {
    const result = errorResult('Something went wrong');

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ error: 'Something went wrong' });
  });

  test('content text is valid JSON', () => {
    const result = errorResult('Bad input "with quotes"');
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });
});

// ============================================================================
// parseRawCliOutput
// ============================================================================

describe('parseRawCliOutput', () => {
  test('parses valid JSON string and wraps in textResult', () => {
    const result = parseRawCliOutput('{"key":"value"}');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ key: 'value' });
  });

  test('wraps non-JSON string in output object', () => {
    const result = parseRawCliOutput('plain text output');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ output: 'plain text output' });
  });

  test('does not include isError property', () => {
    const result = parseRawCliOutput('anything');
    expect('isError' in result).toBe(false);
  });
});
