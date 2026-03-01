/**
 * Error regression test generation from session error patterns.
 */

import { existsSync } from 'fs';
import { loadSessions } from '../shared/sessions.ts';
import { generateErrorTests } from '@gremlin/analysis';
import type { ErrorTestResult } from '@gremlin/analysis';
import { output, exitWithError } from '../../output.ts';
import type { GenerateOptions, GenerateErrorsResult } from './types.ts';

export async function generateErrorsCmd(options: GenerateOptions): Promise<GenerateErrorsResult | null> {
  const {
    input = '.gremlin/sessions',
    minOccurrences = 1,
    json,
  } = options;
  const errOutputDir = '.gremlin/tests/error-regression';

  if (!existsSync(input)) {
    exitWithError('generate', `Sessions directory not found: ${input}`, options);
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    exitWithError('generate', 'No sessions found', options);
  }

  if (!json) {
    console.log('Gremlin Error Regression Test Generator');
    console.log('');
    console.log(`Sessions: ${sessions.length}`);
    console.log(`Min occurrences: ${minOccurrences}`);
    console.log('');
    console.log('Extracting error patterns...');
  }

  const errorResult: ErrorTestResult = generateErrorTests({
    sessions,
    outputDir: errOutputDir,
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

  if (output('generate', result, options)) return result;

  // Human-readable output
  console.log('');
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
