/**
 * Errors command — list and investigate error patterns across sessions
 *
 * Shows deduplicated error patterns with occurrence counts, session IDs,
 * and whether a regression test already covers each pattern.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';
import { extractErrorPatterns, generateErrorTests } from '@gremlin/analysis';
import type { ErrorPattern } from '@gremlin/analysis';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface ErrorsOptions extends OutputOptions {
  input?: string;
  minOccurrences?: number;
  since?: string;
  generate?: boolean;
}

export interface ErrorPatternSummary {
  fingerprint: string;
  message: string;
  errorType: string;
  fatal: boolean;
  occurrences: number;
  sessionIds: string[];
  coveredByTest: boolean;
}

export interface ErrorsResult {
  patterns: ErrorPatternSummary[];
  totalErrors: number;
  uniquePatterns: number;
  coveredByTests: number;
  uncoveredPatterns: number;
}

export interface GenerateErrorsResult {
  errorPatterns: Array<{
    fingerprint: string;
    message: string;
    errorType: string;
    occurrences: number;
    sessionIds: string[];
  }>;
  tests: Array<{ name: string; path: string; type: string }>;
  outputDir: string;
}

// ============================================================================
// Command
// ============================================================================

export async function errors(options: ErrorsOptions): Promise<ErrorsResult | GenerateErrorsResult | null> {
  if (options.generate) {
    return generateErrors(options);
  }

  return listErrors(options);
}

// ============================================================================
// List Errors
// ============================================================================

async function listErrors(options: ErrorsOptions): Promise<ErrorsResult | null> {
  const input = options.input ?? '.gremlin/sessions';
  const minOccurrences = options.minOccurrences ?? 1;
  const json = options.json;

  if (!existsSync(input)) {
    const result: ErrorsResult = {
      patterns: [],
      totalErrors: 0,
      uniquePatterns: 0,
      coveredByTests: 0,
      uncoveredPatterns: 0,
    };
    if (output('errors', result, options)) return result;
    console.log(`No sessions found. Directory does not exist: ${input}`);
    return result;
  }

  const sessions = loadSessions(input, options.since);

  if (sessions.length === 0) {
    const result: ErrorsResult = {
      patterns: [],
      totalErrors: 0,
      uniquePatterns: 0,
      coveredByTests: 0,
      uncoveredPatterns: 0,
    };
    if (output('errors', result, options)) return result;
    console.log(`No sessions found in ${input}`);
    return result;
  }

  const rawPatterns = extractErrorPatterns(sessions);
  const filtered = rawPatterns.filter((p) => p.occurrences >= minOccurrences);

  // Check which patterns have existing test coverage
  const errorTestDir = '.gremlin/tests/error-regression';
  const existingTestFiles = existsSync(errorTestDir)
    ? new Set(readdirSync(errorTestDir).filter((f) => f.endsWith('.spec.ts')))
    : new Set<string>();

  const patterns: ErrorPatternSummary[] = filtered.map((p) => ({
    fingerprint: p.fingerprint,
    message: p.message,
    errorType: p.errorType,
    fatal: p.fatal,
    occurrences: p.occurrences,
    sessionIds: p.sessionIds,
    coveredByTest: existingTestFiles.size > 0 && hasTestForPattern(p, errorTestDir),
  }));

  const coveredByTests = patterns.filter((p) => p.coveredByTest).length;
  const totalErrors = filtered.reduce((sum, p) => sum + p.occurrences, 0);

  const result: ErrorsResult = {
    patterns,
    totalErrors,
    uniquePatterns: patterns.length,
    coveredByTests,
    uncoveredPatterns: patterns.length - coveredByTests,
  };

  if (output('errors', result, options)) return result;

  // Human-readable output
  if (patterns.length === 0) {
    console.log('No error patterns found across sessions.');
    return result;
  }

  console.log(`Error Patterns (${patterns.length} unique, ${totalErrors} total occurrences)`);
  console.log('');

  for (const p of patterns) {
    const fatalTag = p.fatal ? ' [FATAL]' : '';
    const testTag = p.coveredByTest ? ' [TEST]' : '';
    console.log(`  ${p.errorType}${fatalTag}${testTag}: ${p.message}`);
    console.log(`    Occurrences: ${p.occurrences} | Sessions: ${p.sessionIds.length} | Fingerprint: ${p.fingerprint}`);
  }

  console.log('');
  console.log(`Coverage: ${coveredByTests}/${patterns.length} patterns have regression tests`);

  if (result.uncoveredPatterns > 0) {
    console.log(`\nGenerate tests for uncovered patterns:`);
    console.log(`  gremlin generate --errors`);
  }

  return result;
}

// ============================================================================
// Generate Errors (--generate shorthand)
// ============================================================================

async function generateErrors(options: ErrorsOptions): Promise<GenerateErrorsResult | null> {
  const input = options.input ?? '.gremlin/sessions';
  const minOccurrences = options.minOccurrences ?? 1;
  const json = options.json;
  const outputDir = '.gremlin/tests/error-regression';

  if (!existsSync(input)) {
    if (outputError('errors', [`Sessions directory not found: ${input}`], options)) {
      process.exit(1);
    }
    console.error(`Sessions directory not found: ${input}`);
    process.exit(1);
  }

  const sessions = loadSessions(input, options.since);

  if (sessions.length === 0) {
    if (outputError('errors', ['No sessions found'], options)) {
      process.exit(1);
    }
    console.error('No sessions found');
    process.exit(1);
  }

  if (!json) {
    console.log('Gremlin Error Regression Test Generator');
    console.log('');
    console.log(`Sessions: ${sessions.length}`);
    console.log(`Min occurrences: ${minOccurrences}`);
    console.log('');
  }

  const errorResult = generateErrorTests({
    sessions,
    outputDir,
    minOccurrences,
  });

  const result: GenerateErrorsResult = {
    errorPatterns: errorResult.patterns.map((p) => ({
      fingerprint: p.fingerprint,
      message: p.message,
      errorType: p.errorType,
      occurrences: p.occurrences,
      sessionIds: p.sessionIds,
    })),
    tests: errorResult.tests.map((t) => ({
      name: t.name,
      path: t.path,
      type: t.type,
    })),
    outputDir: errorResult.outputDir,
  };

  if (output('errors', result, options)) return result;

  // Human-readable output
  if (errorResult.patterns.length === 0) {
    console.log('No error patterns found.');
  } else {
    console.log(`Found ${errorResult.patterns.length} error pattern(s):`);
    for (const p of errorResult.patterns) {
      const fatalTag = p.fatal ? ' [FATAL]' : '';
      console.log(`  ${p.errorType}${fatalTag}: ${p.message} (${p.occurrences} occurrences)`);
    }
  }

  console.log('');
  if (errorResult.tests.length === 0) {
    console.log('No tests generated.');
  } else {
    console.log(`Generated ${errorResult.tests.length} test(s):`);
    for (const t of errorResult.tests) {
      console.log(`  ${t.type}: ${t.name} -> ${t.path}`);
    }
  }

  console.log('');
  console.log('Next steps:');
  console.log('  gremlin run --json');

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function loadSessions(dir: string, since?: string): GremlinSession[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const sessions: GremlinSession[] = [];
  const sinceTime = since ? new Date(since).getTime() : 0;

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const session = JSON.parse(content) as GremlinSession;

      if (sinceTime && (session.header?.startTime ?? 0) < sinceTime) {
        continue;
      }

      sessions.push(session);
    } catch {
      // Skip unreadable files
    }
  }

  return sessions;
}

function hasTestForPattern(pattern: ErrorPattern, testDir: string): boolean {
  // Check if any test file in the directory references this pattern's fingerprint
  try {
    const files = readdirSync(testDir).filter((f) => f.endsWith('.spec.ts'));
    for (const file of files) {
      const content = readFileSync(join(testDir, file), 'utf-8');
      if (content.includes(pattern.message.substring(0, 40))) {
        return true;
      }
    }
  } catch {
    // Directory not readable
  }
  return false;
}
