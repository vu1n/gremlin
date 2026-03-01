/**
 * Output utilities for CLI commands
 *
 * Provides structured JSON output when --json flag is used,
 * otherwise falls through to existing human-readable console output.
 */

interface JsonEnvelope<T = unknown> {
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
 * Output command error. Prints JSON envelope to stdout if --json
 * (consistent with `output()` so JSON consumers can read a single stream),
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

  console.log(JSON.stringify(envelope));
  return true;
}

/**
 * Print error (JSON or human) and exit.
 * Replaces the verbose dual-path pattern: outputError → exit / console.error → exit
 */
export function exitWithError(
  command: string,
  message: string,
  opts: OutputOptions,
  extra?: { data?: unknown; meta?: Record<string, unknown> }
): never {
  if (!outputError(command, [message], opts, extra)) {
    console.error(message);
  }
  process.exit(1);
}

/**
 * Write a single NDJSON line to stdout (for streaming commands like `dev`).
 */
export function outputNdjson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data));
}
