/**
 * Tests for statistical utility functions.
 *
 * Covers:
 * - percentile: ceiling-method percentile on sorted arrays
 * - aggregateMetric: median, p75, p95 computation
 */

import { describe, test, expect } from 'bun:test';
import { percentile, aggregateMetric } from './stats.ts';

// ============================================================================
// percentile
// ============================================================================

describe('percentile', () => {
  test('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  test('returns the single value for a 1-element array at any percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  test('computes median (p50) for an odd-length array', () => {
    // [1, 2, 3, 4, 5] -> ceil(0.5 * 5) - 1 = 2 -> value 3
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  test('computes median (p50) for an even-length array', () => {
    // [10, 20, 30, 40] -> ceil(0.5 * 4) - 1 = 1 -> value 20
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });

  test('computes p95 correctly', () => {
    // [1..20] -> ceil(0.95 * 20) - 1 = 18 -> value 19
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(sorted, 95)).toBe(19);
  });

  test('computes p75 correctly', () => {
    // [1..100] -> ceil(0.75 * 100) - 1 = 74 -> value 75
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 75)).toBe(75);
  });

  test('p0 clamps index to 0', () => {
    // ceil(0 * 5) - 1 = -1 -> clamped to 0 -> value 1
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  test('p100 returns last element', () => {
    // ceil(1.0 * 5) - 1 = 4 -> value 5
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });
});

// ============================================================================
// aggregateMetric
// ============================================================================

describe('aggregateMetric', () => {
  test('returns null for empty array', () => {
    expect(aggregateMetric([])).toBeNull();
  });

  test('computes stats for a single value', () => {
    const result = aggregateMetric([100]);
    expect(result).not.toBeNull();
    expect(result!.median).toBe(100);
    expect(result!.p75).toBe(100);
    expect(result!.p95).toBe(100);
    expect(result!.count).toBe(1);
  });

  test('computes correct median, p75, p95 for multiple values', () => {
    // Unsorted input: verifies sorting is applied internally
    const values = [5, 3, 1, 4, 2];
    const result = aggregateMetric(values);
    expect(result).not.toBeNull();
    // Sorted: [1, 2, 3, 4, 5]
    expect(result!.median).toBe(3); // p50: ceil(2.5)-1=2 -> 3
    expect(result!.p75).toBe(4);   // p75: ceil(3.75)-1=3 -> 4
    expect(result!.p95).toBe(5);   // p95: ceil(4.75)-1=4 -> 5
    expect(result!.count).toBe(5);
  });

  test('does not mutate the input array', () => {
    const values = [5, 3, 1, 4, 2];
    const copy = [...values];
    aggregateMetric(values);
    expect(values).toEqual(copy);
  });

  test('handles larger datasets', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = aggregateMetric(values);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(100);
    expect(result!.median).toBe(50);
    expect(result!.p75).toBe(75);
    expect(result!.p95).toBe(95);
  });
});
