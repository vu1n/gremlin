/**
 * Shared statistical utility functions.
 *
 * These were previously duplicated across server and server-node storage
 * modules (issues #12 and #25).
 */

/**
 * Compute a percentile value from a pre-sorted array of numbers.
 *
 * Uses the "ceiling" method: idx = ceil(p/100 * length) - 1, clamped to 0.
 * The caller is responsible for sorting the array in ascending order.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute median, p75, and p95 for a set of metric values.
 *
 * Returns null when the input array is empty.
 */
export function aggregateMetric(
  values: number[]
): { median: number; p75: number; p95: number; count: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    count: sorted.length,
  };
}
