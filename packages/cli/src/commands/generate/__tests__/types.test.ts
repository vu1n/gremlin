import { describe, test, expect } from 'bun:test';
import type {
  GenerateOptions,
  GenerateResult,
  GeneratePerfResult,
  GenerateErrorsResult,
} from '../types.ts';

/**
 * These tests verify the type contracts exported from generate/types.ts.
 * Since the module only exports TypeScript interfaces, we validate that
 * objects conforming to those shapes pass basic structural checks at runtime.
 */

describe('GenerateResult shape', () => {
  test('can construct a valid GenerateResult', () => {
    const result: GenerateResult = {
      spec: { states: 5, transitions: 10, variables: 2, properties: 3 },
      specPath: '.gremlin/spec.json',
      tests: [
        { type: 'playwright', path: 'tests/flow.spec.ts', count: 3 },
      ],
      provider: 'anthropic',
    };
    expect(result.spec.states).toBe(5);
    expect(result.specPath).toBe('.gremlin/spec.json');
    expect(result.tests).toHaveLength(1);
    expect(result.provider).toBe('anthropic');
  });

  test('supports multiple test entries', () => {
    const result: GenerateResult = {
      spec: { states: 2, transitions: 3, variables: 0, properties: 1 },
      specPath: 'out.json',
      tests: [
        { type: 'playwright', path: 'tests/a.spec.ts', count: 1 },
        { type: 'maestro', path: 'tests/b.yaml', count: 2 },
      ],
      provider: 'openai',
    };
    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].type).toBe('playwright');
    expect(result.tests[1].type).toBe('maestro');
  });
});

describe('GeneratePerfResult shape', () => {
  test('can construct a valid GeneratePerfResult', () => {
    const result: GeneratePerfResult = {
      perfTests: [
        { flowName: 'checkout', path: 'tests/perf/checkout.spec.ts', stepCount: 5 },
      ],
      outputDir: '.gremlin/tests/perf',
      baselineUsed: true,
    };
    expect(result.perfTests).toHaveLength(1);
    expect(result.perfTests[0].flowName).toBe('checkout');
    expect(result.baselineUsed).toBe(true);
  });
});

describe('GenerateErrorsResult shape', () => {
  test('can construct a valid GenerateErrorsResult', () => {
    const result: GenerateErrorsResult = {
      errorPatterns: [
        {
          fingerprint: 'fp-1',
          message: 'Null reference',
          errorType: 'js',
          occurrences: 5,
          sessionIds: ['s1', 's2'],
        },
      ],
      tests: [
        { name: 'error-null-ref', path: 'tests/errors/null.spec.ts', type: 'playwright' },
      ],
      outputDir: '.gremlin/tests/errors',
    };
    expect(result.errorPatterns).toHaveLength(1);
    expect(result.errorPatterns[0].occurrences).toBe(5);
    expect(result.tests[0].name).toBe('error-null-ref');
  });

  test('can construct with empty arrays', () => {
    const result: GenerateErrorsResult = {
      errorPatterns: [],
      tests: [],
      outputDir: 'out',
    };
    expect(result.errorPatterns).toHaveLength(0);
    expect(result.tests).toHaveLength(0);
  });
});

describe('GenerateOptions shape', () => {
  test('all optional fields are optional', () => {
    // GenerateOptions extends OutputOptions which has json?: boolean
    const opts: GenerateOptions = {};
    expect(opts.input).toBeUndefined();
    expect(opts.output).toBeUndefined();
    expect(opts.playwright).toBeUndefined();
    expect(opts.maestro).toBeUndefined();
    expect(opts.perf).toBeUndefined();
    expect(opts.errors).toBeUndefined();
    expect(opts.minOccurrences).toBeUndefined();
    expect(opts.spec).toBeUndefined();
    expect(opts.baseUrl).toBeUndefined();
    expect(opts.appId).toBeUndefined();
    expect(opts.provider).toBeUndefined();
  });

  test('accepts all known provider values', () => {
    const providers: GenerateOptions['provider'][] = ['anthropic', 'openai', 'gemini'];
    for (const p of providers) {
      const opts: GenerateOptions = { provider: p };
      expect(opts.provider).toBe(p);
    }
  });
});
