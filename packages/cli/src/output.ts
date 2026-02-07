/**
 * Output utilities for CLI commands
 *
 * Provides structured JSON output when --json flag is used,
 * otherwise falls through to existing human-readable console output.
 */

// ============================================================================
// Types
// ============================================================================

export interface JsonEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data: T;
  errors?: string[];
  warnings?: string[];
  meta?: Record<string, unknown>;
}

export interface OutputOptions {
  json?: boolean;
}

// ============================================================================
// Output Functions
// ============================================================================

/**
 * Output command result. Prints JSON envelope to stdout if --json,
 * otherwise does nothing (caller handles human output).
 *
 * Returns true if JSON was printed (so caller can skip human output).
 */
export function output<T>(
  command: string,
  data: T,
  opts: OutputOptions,
  extra?: { warnings?: string[]; meta?: Record<string, unknown> }
): boolean {
  if (!opts.json) return false;

  const envelope: JsonEnvelope<T> = {
    ok: true,
    command,
    data,
  };

  if (extra?.warnings?.length) envelope.warnings = extra.warnings;
  if (extra?.meta) envelope.meta = extra.meta;

  console.log(JSON.stringify(envelope));
  return true;
}

/**
 * Output command error. Prints JSON envelope to stderr if --json,
 * otherwise does nothing (caller handles human output).
 *
 * Returns true if JSON was printed.
 */
export function outputError(
  command: string,
  errors: string[],
  opts: OutputOptions,
  extra?: { data?: unknown; meta?: Record<string, unknown> }
): boolean {
  if (!opts.json) return false;

  const envelope: JsonEnvelope = {
    ok: false,
    command,
    data: extra?.data ?? null,
    errors,
  };

  if (extra?.meta) envelope.meta = extra.meta;

  console.error(JSON.stringify(envelope));
  return true;
}

/**
 * Write a single NDJSON line to stdout (for streaming commands like `dev`).
 */
export function outputNdjson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data));
}
