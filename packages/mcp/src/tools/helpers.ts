import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

/** Resolve the CLI package root relative to this file's location in the workspace. */
const CLI_PKG_ROOT = join(import.meta.dir, '..', '..', '..', 'cli');

/** CLI entrypoint resolved from @gremlin/cli package.json `bin` field. */
function resolveCliEntry(): string {
  const pkgPath = join(CLI_PKG_ROOT, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(
      `CLI package.json not found at ${pkgPath}. ` +
      `Ensure @gremlin/cli is installed in the workspace.`
    );
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const binEntry: string | undefined =
    typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.gremlin;
  if (!binEntry) {
    throw new Error(
      `No bin entry found in ${pkgPath}. ` +
      `Ensure @gremlin/cli package.json has a "bin" field.`
    );
  }
  return join(CLI_PKG_ROOT, binEntry);
}

let cliEntry: string | null = null;

/** Validates the CLI entry point exists. Throws a clear error if the workspace is misconfigured. */
function assertCliEntry(): string {
  if (cliEntry) return cliEntry;
  const resolved = resolveCliEntry();
  if (!existsSync(resolved)) {
    throw new Error(
      `CLI entrypoint not found at ${resolved}. ` +
      `Ensure @gremlin/cli is built or run from source.`
    );
  }
  cliEntry = resolved;
  return cliEntry;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliEnvelope {
  ok: boolean;
  command?: string;
  data: unknown;
  errors?: string[];
  warnings?: string[];
  meta?: Record<string, unknown>;
}

export function getProjectRoot(): string {
  return process.cwd();
}

export async function runCliCommand(args: string[], cwd?: string): Promise<CliResult> {
  const entry = assertCliEntry();
  try {
    const proc = Bun.spawn(['bun', 'run', entry, ...args, '--json'], {
      cwd: cwd ?? getProjectRoot(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { exitCode: 1, stdout: '', stderr: e.message || 'Command failed' };
  }
}

function tryParseEnvelope(text: string): CliEnvelope | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
      return {
        ok: Boolean(parsed.ok),
        command: parsed.command,
        data: parsed.data ?? parsed,
        errors: parsed.ok ? undefined : (parsed.errors ?? ['Unknown CLI error']),
        warnings: parsed.warnings,
        meta: parsed.meta,
      };
    }
    return { ok: true, data: parsed };
  } catch {
    return null;
  }
}

export function parseCliJsonEnvelope(result: CliResult): CliEnvelope {
  if (result.exitCode !== 0) {
    // CLI may write JSON error envelope to stdout or stderr
    const stderrEnvelope = tryParseEnvelope(result.stderr);
    if (stderrEnvelope) return { ...stderrEnvelope, ok: false };
    const stdoutEnvelope = tryParseEnvelope(result.stdout);
    if (stdoutEnvelope) return { ...stdoutEnvelope, ok: false };
    return { ok: false, data: null, errors: [result.stderr || 'Command failed'] };
  }
  // exitCode === 0 but non-JSON output is a protocol violation (CLI is always invoked with --json)
  return tryParseEnvelope(result.stdout) ?? {
    ok: false,
    data: null,
    errors: ['CLI returned non-JSON output'],
    meta: { rawOutput: result.stdout },
  };
}

export function textResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

export function parseRawCliOutput(raw: string): { content: { type: 'text'; text: string }[] } {
  try {
    return textResult(JSON.parse(raw));
  } catch {
    return textResult({ output: raw });
  }
}

/**
 * Creates a tool handler that encapsulates the common CLI-invoke-and-parse pattern.
 * `buildArgs` receives the tool params and returns the CLI argument array.
 */
export function createToolHandler(
  buildArgs: (params: Record<string, unknown>) => string[]
): (params: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  return async (params) => {
    const args = buildArgs(params);
    const result = await runCliCommand(args);
    const envelope = parseCliJsonEnvelope(result);
    if (!envelope.ok) {
      return errorResult(envelope.errors?.[0] ?? 'Command failed');
    }
    return textResult(envelope.data);
  };
}
