import { describe, test, expect } from 'bun:test';
import { percentile } from '../../stats.ts';

describe('percentile', () => {
  test('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  test('returns the single element for single-element array', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  test('returns correct p50 for sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // ceil(50/100 * 10) - 1 = ceil(5) - 1 = 4 => sorted[4] = 5
    expect(percentile(sorted, 50)).toBe(5);
  });

  test('returns correct p75 for sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // ceil(75/100 * 10) - 1 = ceil(7.5) - 1 = 7 => sorted[7] = 8
    expect(percentile(sorted, 75)).toBe(8);
  });

  test('returns correct p95 for sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // ceil(95/100 * 10) - 1 = ceil(9.5) - 1 = 9 => sorted[9] = 10
    expect(percentile(sorted, 95)).toBe(10);
  });

  test('clamps to index 0 for very low percentiles', () => {
    const sorted = [10, 20, 30];
    // ceil(1/100 * 3) - 1 = ceil(0.03) - 1 = 0 => max(0, 0) = 0
    expect(percentile(sorted, 1)).toBe(10);
  });

  test('returns last element for p100', () => {
    const sorted = [10, 20, 30];
    // ceil(100/100 * 3) - 1 = 3 - 1 = 2 => sorted[2] = 30
    expect(percentile(sorted, 100)).toBe(30);
  });

  test('works with two elements', () => {
    const sorted = [100, 200];
    // p50: ceil(0.5 * 2) - 1 = 1 - 1 = 0 => 100
    expect(percentile(sorted, 50)).toBe(100);
    // p75: ceil(0.75 * 2) - 1 = ceil(1.5) - 1 = 1 => 200
    expect(percentile(sorted, 75)).toBe(200);
  });
});
