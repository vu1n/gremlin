/**
 * Fuzz Test Generator
 *
 * Thin orchestration layer that wires the fuzz planner (domain logic)
 * to the fuzz renderer (Playwright code generation).
 *
 * All planning logic lives in fuzz-planner.ts.
 * All Playwright rendering lives in fuzz-renderer.ts.
 */

// Re-export planning types and functions
export type {
  FuzzOptions,
  FuzzStrategy,
  FuzzTest,
  FuzzStep,
  FuzzStepType,
  CustomFuzzAction,
} from './fuzz-planner.ts';
export {
  generateFuzzTests,
  createSeededRandom,
  EVIL_STRINGS,
  findPathToState,
} from './fuzz-planner.ts';

// Re-export rendering functions
export {
  fuzzTestToPlaywright,
  fuzzTestsToPlaywrightFile,
} from './fuzz-renderer.ts';
