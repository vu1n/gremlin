/**
 * Shared statistical utility for CLI analytics commands.
 *
 * Extracted to avoid duplicating the percentile logic across
 * analytics.ts and perf-baseline.ts (issue #12).
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
