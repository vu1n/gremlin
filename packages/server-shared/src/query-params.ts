import { PERF_KEYS, PERF_FILTERABLE_KEYS } from './perf-types.ts';
import type { PerfSortKey, PerfQueryOptions } from './perf-types.ts';

/** Filter map derived from canonical PERF_FILTERABLE_KEYS. */
const PERF_FILTER_MAP: Record<string, PerfSortKey> = Object.fromEntries(
  PERF_FILTERABLE_KEYS.map((k) => [k, k])
) as Record<string, PerfSortKey>;

/** Sort key validator derived from canonical PERF_KEYS. */
function isValidSortKey(key: string): key is PerfSortKey {
  return (PERF_KEYS as readonly string[]).includes(key);
}

// ============================================================================
// Session list params (shared limit/cursor parsing)
// ============================================================================

export interface SessionListParams {
  limit: number;
  cursor?: string;
}

export type SessionListParamsResult = {
  ok: true;
  params: SessionListParams;
} | {
  ok: false;
  error: string;
};

/**
 * Parse and validate `limit` and `cursor` query parameters for session listing.
 *
 * Returns an error when `limit` is present but invalid (non-numeric or < 1).
 * When `limit` is absent, defaults to 20. Caps at 100.
 */
export function parseSessionListParams(query: Record<string, string | undefined>): SessionListParamsResult {
  const limitParam = query.limit;
  let limit = 20;

  if (limitParam !== undefined && limitParam !== '') {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      return { ok: false, error: 'Invalid limit parameter' };
    }
    limit = Math.min(parsed, 100);
  }

  return {
    ok: true,
    params: {
      limit,
      cursor: query.cursor || undefined,
    },
  };
}

// ============================================================================
// Perf query params
// ============================================================================

export type PerfQueryParamsResult = {
  ok: true;
  params: PerfQueryOptions;
} | {
  ok: false;
  error: string;
};

/**
 * Parse performance query parameters.
 *
 * Returns a discriminated result — invalid limit is rejected consistently
 * with {@link parseSessionListParams} to avoid mode-dependent error behavior.
 */
export function parsePerfQueryParams(query: Record<string, string>): PerfQueryParamsResult {
  const opts: PerfQueryOptions = {};

  if (query.sort && isValidSortKey(query.sort)) {
    opts.sort = query.sort;
  }
  if (query.order === 'asc' || query.order === 'desc') {
    opts.order = query.order;
  }

  // Use the shared limit/cursor parser — reject invalid limit consistently
  const listResult = parseSessionListParams(query);
  if (!listResult.ok) {
    return { ok: false, error: listResult.error };
  }
  if (query.limit) opts.limit = listResult.params.limit;
  if (listResult.params.cursor) opts.cursor = listResult.params.cursor;

  const filters: PerfQueryOptions['filters'] = [];
  for (const [param, val] of Object.entries(query)) {
    const gtMatch = param.match(/^(\w+)_gt$/);
    const ltMatch = param.match(/^(\w+)_lt$/);
    const match = gtMatch || ltMatch;
    if (!match) continue;
    const filterName = match[1];
    const sortKey = PERF_FILTER_MAP[filterName];
    if (!sortKey) continue;
    const num = parseFloat(val);
    if (isNaN(num)) continue;
    filters.push({ key: sortKey, op: gtMatch ? 'gt' : 'lt', value: num });
  }

  if (filters.length > 0) opts.filters = filters;
  return { ok: true, params: opts };
}
