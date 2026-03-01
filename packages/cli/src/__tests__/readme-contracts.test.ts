/**
 * README governance contract tests
 *
 * Verifies that claims made in README.md match the runtime reality:
 * - CLI commands referenced in the README are registered in the Commander program
 * - The global --json flag is present on the CLI program
 * - MCP tool names listed in the README match the actual MCP tool registry
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const README_PATH = join(REPO_ROOT, 'README.md');
const readme = readFileSync(README_PATH, 'utf-8');
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'src', 'index.ts');

/** Spawn CLI with --help and return stdout text. */
async function getCliHelpText(): Promise<string> {
  const proc = Bun.spawn(
    ['bun', 'run', CLI_ENTRY, '--help'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

/**
 * Extract CLI commands referenced in the README as shell invocations.
 *
 * Only picks up lines that look like actual CLI usage: lines beginning with
 * `gremlin` (possibly indented in a code block) and captures the first word
 * after it. Filters out prose occurrences by requiring the line to resemble
 * a shell command (no surrounding prose words before "gremlin" on that line,
 * or prefixed with `run:` for CI YAML).
 */
function extractReadmeCliCommands(text: string): string[] {
  const commands = new Set<string>();
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match lines that start with "gremlin <command>" (shell code blocks)
    // or contain "run: gremlin <command>" (CI YAML)
    // or contain backtick-quoted `gremlin <command>`
    const shellMatch = trimmed.match(/^gremlin\s+([\w-]+)/);
    const yamlMatch = trimmed.match(/run:\s*gremlin\s+([\w-]+)/);
    const backtickMatch = trimmed.match(/`gremlin\s+([\w-]+)/);
    const numberedMatch = trimmed.match(/^\d+\.\s+`gremlin\s+([\w-]+)/);

    for (const m of [shellMatch, yamlMatch, backtickMatch, numberedMatch]) {
      if (m && /^[a-z][\w-]*$/.test(m[1])) {
        commands.add(m[1]);
      }
    }
  }

  return [...commands];
}

/** Extract MCP tool names from the README table. */
function extractReadmeMcpToolNames(text: string): string[] {
  // The README has a markdown table with tool names in backticks: | `gremlin_status` | ...
  const pattern = /\|\s*`(gremlin_\w+)`\s*\|/g;
  const tools: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    tools.push(m[1]);
  }
  return tools;
}

/** Get actual MCP tool names by creating the server and inspecting its internal registry. */
async function getActualMcpToolNames(): Promise<string[]> {
  const { createServer } = await import('../../../../packages/mcp/src/index.ts');
  const server = createServer();

  // McpServer stores tools in _registeredTools as a plain object { [name]: ... }
  const registeredTools: Record<string, unknown> | undefined =
    (server as any)._registeredTools;

  if (registeredTools && typeof registeredTools === 'object') {
    return Object.keys(registeredTools);
  }

  // Fallback: extract tool names from MCP tool source files
  const toolFiles = [
    'status.ts', 'sessions.ts', 'analytics.ts', 'generate.ts',
    'run.ts', 'instrument.ts', 'analyze.ts', 'init.ts', 'perf.ts', 'errors.ts',
  ];
  const toolNames: string[] = [];
  for (const file of toolFiles) {
    const content = readFileSync(
      join(REPO_ROOT, 'packages', 'mcp', 'src', 'tools', file),
      'utf-8',
    );
    const namePattern = /server\.tool\(\s*['"](\w+)['"]/g;
    let tm: RegExpExecArray | null;
    while ((tm = namePattern.exec(content)) !== null) {
      toolNames.push(tm[1]);
    }
  }
  return toolNames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('README governance contracts', () => {
  test('README.md exists and is non-empty', () => {
    expect(readme.length).toBeGreaterThan(100);
  });

  describe('CLI commands match README claims', () => {
    test('every CLI command referenced in README exists in the program', async () => {
      const helpText = await getCliHelpText();
      const readmeCommands = extractReadmeCliCommands(readme);

      expect(readmeCommands.length).toBeGreaterThan(0);

      // Subcommands may not show in top-level help; we accept parent presence
      const subcommandParents: Record<string, string> = {
        summary: 'analytics',
        performance: 'analytics',
        local: 'deploy',
        docker: 'deploy',
        stop: 'deploy',
      };

      for (const cmd of readmeCommands) {
        const parent = subcommandParents[cmd];
        const found =
          helpText.includes(cmd) ||
          (parent != null && helpText.includes(parent));
        expect(found).toBe(true);
      }
    });
  });

  describe('--json global flag', () => {
    test('--help output mentions --json flag', async () => {
      const helpText = await getCliHelpText();
      expect(helpText).toContain('--json');
    });

    test('README claims all commands support --json', () => {
      expect(readme).toContain('--json');
      // Specific claim: "Every CLI command supports `--json`"
      expect(readme).toMatch(/every cli command supports.*--json/i);
    });

    test('--json flag produces valid JSON envelope on a safe command', async () => {
      const proc = Bun.spawn(
        ['bun', 'run', CLI_ENTRY, 'status', '--json'],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Should produce parseable JSON
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('ok');
      expect(parsed).toHaveProperty('command');
    });
  });

  describe('MCP tool names match README claims', () => {
    test('README lists MCP tools', () => {
      const readmeTools = extractReadmeMcpToolNames(readme);
      expect(readmeTools.length).toBeGreaterThan(0);
    });

    test('every MCP tool in README exists in the actual registry', async () => {
      const readmeTools = extractReadmeMcpToolNames(readme);
      const actualTools = await getActualMcpToolNames();

      expect(actualTools.length).toBeGreaterThan(0);

      for (const tool of readmeTools) {
        expect(actualTools).toContain(tool);
      }
    });

    test('every registered MCP tool is documented in README', async () => {
      const readmeTools = new Set(extractReadmeMcpToolNames(readme));
      const actualTools = await getActualMcpToolNames();

      for (const tool of actualTools) {
        expect(readmeTools.has(tool)).toBe(true);
      }
    });

    test('README tool count matches actual tool count', async () => {
      const readmeTools = extractReadmeMcpToolNames(readme);
      const actualTools = await getActualMcpToolNames();

      expect(readmeTools.length).toBe(actualTools.length);
    });
  });
});
