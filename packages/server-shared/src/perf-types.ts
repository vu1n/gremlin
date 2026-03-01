/**
 * Shared performance query types.
 *
 * Extracted from routes.ts to break the circular dependency between
 * routes.ts and query-params.ts: routes imports parsePerfQueryParams
 * from query-params, and query-params needs PerfSortKey / PerfQueryOptions.
 */

/**
 * Canonical list of performance metric keys. This is the single source
 * of truth — PerfSortKey, the filter map, and the sort validator are
 * all derived from this array.
 */
export const PERF_KEYS = [
  'lcp', 'cls', 'inp', 'fcp', 'ttfb',
  'avgFps', 'minFps', 'longTasks', 'peakMemory', 'pageLoad',
  'duration', 'eventCount', 'startTime',
] as const;

export type PerfSortKey = (typeof PERF_KEYS)[number];

/** Keys that can be used in filter expressions (all except startTime). */
export const PERF_FILTERABLE_KEYS = PERF_KEYS.filter(
  (k): k is Exclude<PerfSortKey, 'startTime'> => k !== 'startTime'
);

export interface PerfQueryOptions {
  sort?: PerfSortKey;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  filters?: { key: PerfSortKey; op: 'gt' | 'lt'; value: number }[];
}
