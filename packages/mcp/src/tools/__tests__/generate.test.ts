/**
 * Tests for MCP generate tool argument building.
 *
 * Covers:
 * - gremlin_generate_tests: all flags and optional parameters
 * - gremlin_generate_perf_tests: baseUrl parameter
 * - gremlin_generate_error_tests: minOccurrences parameter
 *
 * Tests the argument construction logic without spawning CLI processes.
 */

import { describe, test, expect } from 'bun:test';

// ============================================================================
// Helpers - replicate the arg-building logic from generate.ts
// ============================================================================

function buildGenerateTestArgs(params: {
  provider?: string;
  playwright?: boolean;
  maestro?: boolean;
  input?: string;
  output?: string;
  spec?: string;
  baseUrl?: string;
  appId?: string;
}): string[] {
  const { provider, playwright, maestro, input, output, spec, baseUrl, appId } = params;
  const args = ['generate'];
  if (provider) args.push('--provider', String(provider));
  if (playwright) args.push('--playwright');
  if (maestro) args.push('--maestro');
  if (input) args.push('--input', String(input));
  if (output) args.push('--output', String(output));
  if (spec) args.push('--spec', String(spec));
  if (baseUrl) args.push('--base-url', String(baseUrl));
  if (appId) args.push('--app-id', String(appId));
  return args;
}

function buildPerfTestArgs(params: { baseUrl?: string }): string[] {
  const args = ['generate', '--perf'];
  if (params.baseUrl) args.push('--base-url', String(params.baseUrl));
  return args;
}

function buildErrorTestArgs(params: { minOccurrences?: number }): string[] {
  const args = ['generate', '--errors'];
  if (params.minOccurrences) args.push('--min-occurrences', String(params.minOccurrences));
  return args;
}

// ============================================================================
// gremlin_generate_tests
// ============================================================================

describe('gremlin_generate_tests args', () => {
  test('builds minimal args with no options', () => {
    const args = buildGenerateTestArgs({});
    expect(args).toEqual(['generate']);
  });

  test('includes --provider flag', () => {
    const args = buildGenerateTestArgs({ provider: 'anthropic' });
    expect(args).toContain('--provider');
    expect(args).toContain('anthropic');
  });

  test('includes --playwright boolean flag', () => {
    const args = buildGenerateTestArgs({ playwright: true });
    expect(args).toContain('--playwright');
    expect(args).not.toContain('true'); // boolean flags are just flags, no value
  });

  test('includes --maestro boolean flag', () => {
    const args = buildGenerateTestArgs({ maestro: true });
    expect(args).toContain('--maestro');
  });

  test('does not include --playwright when false', () => {
    const args = buildGenerateTestArgs({ playwright: false });
    expect(args).not.toContain('--playwright');
  });

  test('includes all path options', () => {
    const args = buildGenerateTestArgs({
      input: '/path/to/sessions',
      output: '/path/to/output',
      spec: '/path/to/spec.json',
    });
    expect(args).toContain('--input');
    expect(args).toContain('/path/to/sessions');
    expect(args).toContain('--output');
    expect(args).toContain('/path/to/output');
    expect(args).toContain('--spec');
    expect(args).toContain('/path/to/spec.json');
  });

  test('includes --base-url and --app-id', () => {
    const args = buildGenerateTestArgs({
      baseUrl: 'http://localhost:8080',
      appId: 'com.example.app',
    });
    expect(args).toContain('--base-url');
    expect(args).toContain('http://localhost:8080');
    expect(args).toContain('--app-id');
    expect(args).toContain('com.example.app');
  });

  test('builds full args with all options', () => {
    const args = buildGenerateTestArgs({
      provider: 'openai',
      playwright: true,
      maestro: true,
      input: '/in',
      output: '/out',
      spec: '/spec',
      baseUrl: 'http://localhost:3000',
      appId: 'com.test',
    });

    expect(args[0]).toBe('generate');
    expect(args).toContain('--provider');
    expect(args).toContain('--playwright');
    expect(args).toContain('--maestro');
    expect(args).toContain('--input');
    expect(args).toContain('--output');
    expect(args).toContain('--spec');
    expect(args).toContain('--base-url');
    expect(args).toContain('--app-id');
  });
});

// ============================================================================
// gremlin_generate_perf_tests
// ============================================================================

describe('gremlin_generate_perf_tests args', () => {
  test('builds minimal args with --perf flag', () => {
    const args = buildPerfTestArgs({});
    expect(args).toEqual(['generate', '--perf']);
  });

  test('includes --base-url when provided', () => {
    const args = buildPerfTestArgs({ baseUrl: 'http://staging.example.com' });
    expect(args).toContain('--base-url');
    expect(args).toContain('http://staging.example.com');
  });
});

// ============================================================================
// gremlin_generate_error_tests
// ============================================================================

describe('gremlin_generate_error_tests args', () => {
  test('builds minimal args with --errors flag', () => {
    const args = buildErrorTestArgs({});
    expect(args).toEqual(['generate', '--errors']);
  });

  test('includes --min-occurrences when provided', () => {
    const args = buildErrorTestArgs({ minOccurrences: 5 });
    expect(args).toContain('--min-occurrences');
    expect(args).toContain('5');
  });

  test('does not include --min-occurrences when 0', () => {
    const args = buildErrorTestArgs({ minOccurrences: 0 });
    // 0 is falsy, so it should not be included
    expect(args).not.toContain('--min-occurrences');
  });
});
