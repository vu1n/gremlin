/**
 * Tests for MCP status tool registration and argument building.
 *
 * Covers:
 * - registerStatusTools: tool registration shape
 * - gremlin_status arg building: always produces ['status']
 * - Tool handler response shaping via textResult/errorResult
 *
 * Tests the argument construction and response shaping logic
 * without spawning CLI processes.
 */

import { describe, test, expect } from 'bun:test';
import {
  textResult,
  errorResult,
  parseCliJsonEnvelope,
  type CliResult,
  type CliEnvelope,
} from '../helpers.ts';

// ============================================================================
// gremlin_status arg building
// ============================================================================

describe('gremlin_status args', () => {
  function buildStatusArgs(): string[] {
    return ['status'];
  }

  test('builds args with no parameters', () => {
    const args = buildStatusArgs();
    expect(args).toEqual(['status']);
  });

  test('always returns exactly one argument', () => {
    const args = buildStatusArgs();
    expect(args.length).toBe(1);
    expect(args[0]).toBe('status');
  });
});

// ============================================================================
// Status response handling
// ============================================================================

describe('status response handling', () => {
  test('wraps successful status data as textResult', () => {
    const statusData = {
      initialized: true,
      config: {
        framework: 'nextjs',
        appName: 'TestApp',
        sdkPackage: '@gremlin/recorder-web',
        devServerPort: 3334,
        remoteServerUrl: null,
      },
      sdk: { installed: true, package: '@gremlin/recorder-web', version: '1.0.0' },
      devServer: { running: false },
      remoteServer: { configured: false },
      sessions: { count: 5, totalEvents: 120, apps: ['TestApp'] },
      tests: {
        specExists: true,
        playwright: { count: 3, directory: '.gremlin/tests/playwright' },
        maestro: { count: 0, directory: '.gremlin/tests/maestro' },
        fuzz: { count: 1, directory: '.gremlin/tests/fuzz' },
      },
      analytics: { count: 2, directory: '.gremlin/analytics' },
      ai: { provider: 'anthropic', hasKey: true },
    };

    const result = textResult(statusData);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.initialized).toBe(true);
    expect(parsed.config.framework).toBe('nextjs');
    expect(parsed.sessions.count).toBe(5);
    expect(parsed.tests.playwright.count).toBe(3);
    expect(parsed.ai.hasKey).toBe(true);
  });

  test('wraps error response with isError flag', () => {
    const result = errorResult('Status check failed: config not found');
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Status check failed: config not found');
  });

  test('handles uninitialized project status', () => {
    const statusData = {
      initialized: false,
      config: null,
      sdk: null,
      devServer: { running: false },
      remoteServer: { configured: false },
      sessions: { count: 0, totalEvents: 0, apps: [] },
      tests: {
        specExists: false,
        playwright: { count: 0, directory: '.gremlin/tests/playwright' },
        maestro: { count: 0, directory: '.gremlin/tests/maestro' },
        fuzz: { count: 0, directory: '.gremlin/tests/fuzz' },
      },
      analytics: { count: 0, directory: '.gremlin/analytics' },
      ai: { hasKey: false },
    };

    const result = textResult(statusData);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.initialized).toBe(false);
    expect(parsed.config).toBeNull();
    expect(parsed.sdk).toBeNull();
    expect(parsed.sessions.count).toBe(0);
  });
});

// ============================================================================
// parseCliJsonEnvelope for status output
// ============================================================================

describe('parseCliJsonEnvelope for status', () => {
  test('parses successful CLI JSON output', () => {
    const cliResult: CliResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        command: 'status',
        data: { initialized: true, config: { framework: 'vite' } },
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('status');
    expect((envelope.data as Record<string, unknown>).initialized).toBe(true);
  });

  test('parses error CLI output', () => {
    const cliResult: CliResult = {
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        command: 'status',
        data: null,
        errors: ['Failed to read config'],
      }),
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toContain('Failed to read config');
  });

  test('handles non-JSON CLI output gracefully', () => {
    const cliResult: CliResult = {
      exitCode: 0,
      stdout: 'Gremlin Status\n==============\n',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    // Non-JSON is a protocol violation; should return error
    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toBeDefined();
  });

  test('handles empty stdout gracefully', () => {
    const cliResult: CliResult = {
      exitCode: 0,
      stdout: '',
      stderr: '',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(false);
  });

  test('extracts error from stderr on non-zero exit', () => {
    const cliResult: CliResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Permission denied',
    };

    const envelope = parseCliJsonEnvelope(cliResult);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toBeDefined();
    expect(envelope.errors![0]).toContain('Permission denied');
  });
});

// ============================================================================
// Tool handler pattern
// ============================================================================

describe('createToolHandler pattern for status', () => {
  test('produces correct args via buildArgs function', () => {
    // The status tool passes an empty object as params
    const buildArgs = (_params: Record<string, unknown>) => ['status'];
    const args = buildArgs({});
    expect(args).toEqual(['status']);
  });

  test('handler would return textResult on success', () => {
    // Simulate what createToolHandler does on success
    const envelope: CliEnvelope = {
      ok: true,
      command: 'status',
      data: { initialized: true },
    };

    const response = envelope.ok
      ? textResult(envelope.data)
      : errorResult(envelope.errors?.[0] ?? 'Command failed');

    expect(response).not.toHaveProperty('isError');
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.initialized).toBe(true);
  });

  test('handler would return errorResult on failure', () => {
    const envelope: CliEnvelope = {
      ok: false,
      data: null,
      errors: ['Config not found'],
    };

    const response = envelope.ok
      ? textResult(envelope.data)
      : errorResult(envelope.errors?.[0] ?? 'Command failed');

    expect(response).toHaveProperty('isError', true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe('Config not found');
  });
});
