import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { output, outputError, exitWithError, outputNdjson } from '../output.ts';

// ============================================================================
// Helpers: capture console output
// ============================================================================

let logOutput: string[] = [];
let errorOutput: string[] = [];

const origLog = console.log;
const origError = console.error;

beforeEach(() => {
  logOutput = [];
  errorOutput = [];
  console.log = (...args: unknown[]) => {
    logOutput.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errorOutput.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
});

// ============================================================================
// output()
// ============================================================================

describe('output', () => {
  test('returns false and prints nothing when json option is false', () => {
    const result = output('status', { running: true }, { json: false });
    expect(result).toBe(false);
    expect(logOutput).toEqual([]);
  });

  test('returns false when json option is undefined', () => {
    const result = output('status', { running: true }, {});
    expect(result).toBe(false);
    expect(logOutput).toEqual([]);
  });

  test('produces correct JSON envelope when json is true', () => {
    const data = { sessions: 5, active: true };
    const result = output('status', data, { json: true });

    expect(result).toBe(true);
    expect(logOutput.length).toBe(1);

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('status');
    expect(envelope.data).toEqual(data);
    expect(envelope.errors).toBeUndefined();
    expect(envelope.warnings).toBeUndefined();
    expect(envelope.meta).toBeUndefined();
  });

  test('includes warnings when provided', () => {
    output('deploy', { url: 'http://localhost' }, { json: true }, {
      warnings: ['Port already in use', 'Using fallback'],
    });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.warnings).toEqual(['Port already in use', 'Using fallback']);
  });

  test('omits warnings key when warnings array is empty', () => {
    output('deploy', {}, { json: true }, { warnings: [] });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.warnings).toBeUndefined();
  });

  test('includes meta when provided', () => {
    output('analyze', { score: 85 }, { json: true }, {
      meta: { duration: 1200, version: '1.0.0' },
    });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.meta).toEqual({ duration: 1200, version: '1.0.0' });
  });

  test('handles null data', () => {
    output('status', null, { json: true });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toBeNull();
  });

  test('handles array data', () => {
    output('sessions', [{ id: 1 }, { id: 2 }], { json: true });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.data).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

// ============================================================================
// outputError()
// ============================================================================

describe('outputError', () => {
  test('returns false when json option is false', () => {
    const result = outputError('deploy', ['Connection failed'], { json: false });
    expect(result).toBe(false);
    expect(errorOutput).toEqual([]);
  });

  test('produces correct error envelope when json is true', () => {
    const result = outputError('deploy', ['Connection refused', 'Timeout'], { json: true });

    expect(result).toBe(true);
    expect(logOutput.length).toBe(1);

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('deploy');
    expect(envelope.data).toBeNull();
    expect(envelope.errors).toEqual(['Connection refused', 'Timeout']);
  });

  test('includes data when provided in extra', () => {
    outputError('import', ['Bad format'], { json: true }, {
      data: { file: 'session.json' },
    });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.data).toEqual({ file: 'session.json' });
  });

  test('includes meta when provided in extra', () => {
    outputError('run', ['Failed'], { json: true }, {
      meta: { exitCode: 1 },
    });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.meta).toEqual({ exitCode: 1 });
  });

  test('defaults data to null when extra.data not provided', () => {
    outputError('cmd', ['err'], { json: true });

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.data).toBeNull();
  });
});

// ============================================================================
// exitWithError()
// ============================================================================

describe('exitWithError', () => {
  test('outputs JSON error envelope and exits with code 1 in json mode', () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
    }) as never;

    try {
      exitWithError('deploy', 'Server unreachable', { json: true });
    } catch {
      // process.exit mock doesn't actually throw
    }

    expect(exitCode).toBe(1);
    expect(logOutput.length).toBe(1);

    const envelope = JSON.parse(logOutput[0]);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('deploy');
    expect(envelope.errors).toEqual(['Server unreachable']);

    process.exit = origExit;
  });

  test('outputs human-readable error to stderr in non-json mode', () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
    }) as never;

    try {
      exitWithError('deploy', 'Connection lost', { json: false });
    } catch {
      // process.exit mock
    }

    expect(exitCode).toBe(1);
    // In non-json mode, the message goes to console.error as plain text
    expect(errorOutput.length).toBe(1);
    expect(errorOutput[0]).toBe('Connection lost');

    process.exit = origExit;
  });
});

// ============================================================================
// outputNdjson()
// ============================================================================

describe('outputNdjson', () => {
  test('outputs one JSON line per call', () => {
    outputNdjson({ type: 'event', name: 'pageview' });
    outputNdjson({ type: 'metric', value: 42 });

    expect(logOutput.length).toBe(2);

    const line1 = JSON.parse(logOutput[0]);
    expect(line1).toEqual({ type: 'event', name: 'pageview' });

    const line2 = JSON.parse(logOutput[1]);
    expect(line2).toEqual({ type: 'metric', value: 42 });
  });
});
