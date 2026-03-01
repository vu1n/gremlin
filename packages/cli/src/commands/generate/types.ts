/**
 * Shared types for the generate command family.
 */

import type { OutputOptions } from '../../output.ts';

export interface GenerateOptions extends OutputOptions {
  input?: string;
  output?: string;
  playwright?: boolean;
  maestro?: boolean;
  perf?: boolean;
  errors?: boolean;
  minOccurrences?: number;
  spec?: string;
  baseUrl?: string;
  appId?: string;
  provider?: 'anthropic' | 'openai' | 'gemini';
}

export interface GenerateResult {
  spec: {
    states: number;
    transitions: number;
    variables: number;
    properties: number;
  };
  specPath: string;
  tests: { type: string; path: string; count: number }[];
  provider: string;
}

export interface GeneratePerfResult {
  perfTests: { flowName: string; path: string; stepCount: number }[];
  outputDir: string;
  baselineUsed: boolean;
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
