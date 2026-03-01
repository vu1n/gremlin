/**
 * Generate command — entry point.
 *
 * Re-exports the three generate workflows (tests, perf, errors) and
 * provides the unified `generate()` dispatcher that the CLI invokes.
 */

export type {
  GenerateOptions,
  GenerateResult,
  GeneratePerfResult,
  GenerateErrorsResult,
} from './types.ts';
export { generateTests } from './tests.ts';
export { generatePerf } from './perf.ts';
export { generateErrorsCmd } from './errors.ts';

import type {
  GenerateOptions,
  GenerateResult,
  GeneratePerfResult,
  GenerateErrorsResult,
} from './types.ts';
import { generateTests } from './tests.ts';
import { generatePerf } from './perf.ts';
import { generateErrorsCmd } from './errors.ts';

export function generate(
  options: GenerateOptions
): Promise<GenerateResult | GeneratePerfResult | GenerateErrorsResult | null> {
  if (options.perf) {
    return generatePerf(options);
  }

  if (options.errors) {
    return generateErrorsCmd(options);
  }

  return generateTests(options);
}
