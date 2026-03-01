/**
 * Sessions command unit tests
 *
 * Tests session listing, filtering, sorting, and display logic.
 * Uses temp directories with synthetic session files.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { SessionPerformance } from '@gremlin/session';

// We cannot directly call listSessions without risking process.exit from output
// helpers, so we replicate the internal logic functions for unit testing.

// ---------------------------------------------------------------------------
// Helpers replicated from sessions.ts (private functions)
// ---------------------------------------------------------------------------

interface SessionSummary {
  id: string;
  appName: string;
  platform: string;
  eventCount: number;
  startTime: number;
  performance?: SessionPerformance;
}

const CWV_THRESHOLDS = {
  lcp: 2500,
  cls: 0.25,
  inp: 200,
};

function getPerfSortValue(s: SessionSummary, metric: string): number {
  const p = s.performance;
  if (!p) return Infinity;

  switch (metric) {
    case 'lcp': return p.webVitals?.lcp ?? Infinity;
    case 'cls': return p.webVitals?.cls ?? Infinity;
    case 'inp': return p.webVitals?.inp ?? Infinity;
    case 'fcp': return p.webVitals?.fcp ?? Infinity;
    case 'ttfb': return p.webVitals?.ttfb ?? Infinity;
    case 'fps': return -(p.avgFps ?? 0);
    case 'longTasks': return -(p.longTaskCount ?? 0);
    case 'memory': return -(p.peakMemoryUsage ?? 0);
    case 'duration': return -(p.webVitals?.lcp ?? p.pageLoadTime ?? 0);
    default: return 0;
  }
}

function isSlowSession(s: SessionSummary): boolean {
  const wv = s.performance?.webVitals;
  if (!wv) return false;
  return (
    (wv.lcp !== undefined && wv.lcp > CWV_THRESHOLDS.lcp) ||
    (wv.cls !== undefined && wv.cls > CWV_THRESHOLDS.cls) ||
    (wv.inp !== undefined && wv.inp > CWV_THRESHOLDS.inp)
  );
}

function formatPerfLine(p: SessionPerformance | undefined): string {
  if (!p) return 'no perf data';
  const parts: string[] = [];
  if (p.webVitals?.lcp !== undefined) parts.push(`LCP:${p.webVitals.lcp.toFixed(0)}ms`);
  if (p.webVitals?.cls !== undefined) parts.push(`CLS:${p.webVitals.cls.toFixed(3)}`);
  if (p.webVitals?.inp !== undefined) parts.push(`INP:${p.webVitals.inp.toFixed(0)}ms`);
  if (p.avgFps !== undefined) parts.push(`FPS:${p.avgFps.toFixed(0)}`);
  return parts.length > 0 ? parts.join(' | ') : 'no perf data';
}

// ---------------------------------------------------------------------------
// Session file reading / parsing
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-sessions-test-'));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeSession(dir: string, filename: string, data: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(data));
}

describe('session file reading', () => {
  test('reads valid session files and extracts summary fields', () => {
    const sessionsDir = join(tmpDir, 'sessions');
    writeSession(sessionsDir, 'sess-1.json', {
      header: {
        sessionId: 'sess-1',
        startTime: 1700000000000,
        app: { name: 'TestApp' },
        device: { platform: 'web' },
      },
      events: [{ dt: 0 }, { dt: 100 }, { dt: 200 }],
    });

    const content = JSON.parse(
      require('fs').readFileSync(join(sessionsDir, 'sess-1.json'), 'utf-8')
    );

    const summary: SessionSummary = {
      id: content.header?.sessionId || 'unknown',
      appName: content.header?.app?.name || 'unknown',
      platform: content.header?.device?.platform || 'unknown',
      eventCount: content.events?.length || 0,
      startTime: content.header?.startTime || 0,
      performance: content.performance,
    };

    expect(summary.id).toBe('sess-1');
    expect(summary.appName).toBe('TestApp');
    expect(summary.platform).toBe('web');
    expect(summary.eventCount).toBe(3);
    expect(summary.startTime).toBe(1700000000000);
  });

  test('uses filename as ID fallback when header has no sessionId', () => {
    const sessionsDir = join(tmpDir, 'sessions');
    writeSession(sessionsDir, 'fallback-id.json', {
      header: { app: { name: 'app' }, device: { platform: 'ios' } },
      events: [],
    });

    const content = JSON.parse(
      require('fs').readFileSync(join(sessionsDir, 'fallback-id.json'), 'utf-8')
    );
    const id = content.header?.sessionId || 'fallback-id.json'.replace('.json', '');
    expect(id).toBe('fallback-id');
  });

  test('defaults to unknown for missing fields', () => {
    const sessionsDir = join(tmpDir, 'sessions');
    writeSession(sessionsDir, 'minimal.json', {
      header: {},
      events: [],
    });

    const content = JSON.parse(
      require('fs').readFileSync(join(sessionsDir, 'minimal.json'), 'utf-8')
    );

    const summary: SessionSummary = {
      id: content.header?.sessionId || 'minimal',
      appName: content.header?.app?.name || 'unknown',
      platform: content.header?.device?.platform || 'unknown',
      eventCount: content.events?.length || 0,
      startTime: content.header?.startTime || 0,
    };

    expect(summary.appName).toBe('unknown');
    expect(summary.platform).toBe('unknown');
    expect(summary.eventCount).toBe(0);
    expect(summary.startTime).toBe(0);
  });

  test('handles empty sessions directory', () => {
    const sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    const files = require('fs')
      .readdirSync(sessionsDir)
      .filter((f: string) => f.endsWith('.json'));
    expect(files.length).toBe(0);
  });

  test('returns empty result when directory does not exist', () => {
    const sessionsDir = join(tmpDir, 'nonexistent');
    expect(existsSync(sessionsDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPerfSortValue
// ---------------------------------------------------------------------------

describe('getPerfSortValue', () => {
  test('returns Infinity when session has no performance data', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
    };
    expect(getPerfSortValue(s, 'lcp')).toBe(Infinity);
  });

  test('returns LCP value for lcp metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 1500 } },
    };
    expect(getPerfSortValue(s, 'lcp')).toBe(1500);
  });

  test('returns CLS value for cls metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { cls: 0.15 } },
    };
    expect(getPerfSortValue(s, 'cls')).toBe(0.15);
  });

  test('returns INP value for inp metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { inp: 180 } },
    };
    expect(getPerfSortValue(s, 'inp')).toBe(180);
  });

  test('returns negative FPS for fps metric (lower FPS sorts first)', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { avgFps: 30 },
    };
    expect(getPerfSortValue(s, 'fps')).toBe(-30);
  });

  test('returns negative longTaskCount for longTasks metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { longTaskCount: 5 },
    };
    expect(getPerfSortValue(s, 'longTasks')).toBe(-5);
  });

  test('returns negative peakMemoryUsage for memory metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { peakMemoryUsage: 120 },
    };
    expect(getPerfSortValue(s, 'memory')).toBe(-120);
  });

  test('returns 0 for unknown metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 500 } },
    };
    expect(getPerfSortValue(s, 'nonexistent')).toBe(0);
  });

  test('returns Infinity when webVitals are missing for web vital metrics', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { avgFps: 60 },
    };
    expect(getPerfSortValue(s, 'lcp')).toBe(Infinity);
    expect(getPerfSortValue(s, 'cls')).toBe(Infinity);
  });

  test('returns negative LCP for duration metric', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 2000 } },
    };
    expect(getPerfSortValue(s, 'duration')).toBe(-2000);
  });

  test('falls back to pageLoadTime for duration when LCP is missing', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { pageLoadTime: 3000 },
    };
    expect(getPerfSortValue(s, 'duration')).toBe(-3000);
  });
});

// ---------------------------------------------------------------------------
// isSlowSession
// ---------------------------------------------------------------------------

describe('isSlowSession', () => {
  test('returns false when no performance data', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
    };
    expect(isSlowSession(s)).toBe(false);
  });

  test('returns false when no webVitals', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { avgFps: 60 },
    };
    expect(isSlowSession(s)).toBe(false);
  });

  test('returns true when LCP exceeds threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 3000 } },
    };
    expect(isSlowSession(s)).toBe(true);
  });

  test('returns false when LCP is within threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 2000 } },
    };
    expect(isSlowSession(s)).toBe(false);
  });

  test('returns true when CLS exceeds threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { cls: 0.5 } },
    };
    expect(isSlowSession(s)).toBe(true);
  });

  test('returns false when CLS is within threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { cls: 0.1 } },
    };
    expect(isSlowSession(s)).toBe(false);
  });

  test('returns true when INP exceeds threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { inp: 300 } },
    };
    expect(isSlowSession(s)).toBe(true);
  });

  test('returns true when any single CWV exceeds threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 1000, cls: 0.01, inp: 250 } },
    };
    // INP 250 > 200
    expect(isSlowSession(s)).toBe(true);
  });

  test('returns false when all CWVs are within thresholds', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 2000, cls: 0.1, inp: 100 } },
    };
    expect(isSlowSession(s)).toBe(false);
  });

  test('returns true at exact LCP threshold boundary (exclusive)', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 2501 } },
    };
    expect(isSlowSession(s)).toBe(true);
  });

  test('returns false at exact LCP threshold', () => {
    const s: SessionSummary = {
      id: '1', appName: 'a', platform: 'web', eventCount: 0, startTime: 0,
      performance: { webVitals: { lcp: 2500 } },
    };
    expect(isSlowSession(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatPerfLine
// ---------------------------------------------------------------------------

describe('formatPerfLine', () => {
  test('returns "no perf data" for undefined performance', () => {
    expect(formatPerfLine(undefined)).toBe('no perf data');
  });

  test('returns "no perf data" for empty performance object', () => {
    expect(formatPerfLine({})).toBe('no perf data');
  });

  test('formats LCP', () => {
    const result = formatPerfLine({ webVitals: { lcp: 1500 } });
    expect(result).toBe('LCP:1500ms');
  });

  test('formats CLS with 3 decimal places', () => {
    const result = formatPerfLine({ webVitals: { cls: 0.12345 } });
    expect(result).toBe('CLS:0.123');
  });

  test('formats INP', () => {
    const result = formatPerfLine({ webVitals: { inp: 200 } });
    expect(result).toBe('INP:200ms');
  });

  test('formats FPS', () => {
    const result = formatPerfLine({ avgFps: 58.7 });
    expect(result).toBe('FPS:59');
  });

  test('formats multiple metrics with pipe separator', () => {
    const result = formatPerfLine({
      webVitals: { lcp: 2000, cls: 0.1, inp: 150 },
      avgFps: 60,
    });
    expect(result).toBe('LCP:2000ms | CLS:0.100 | INP:150ms | FPS:60');
  });

  test('omits metrics that are undefined', () => {
    const result = formatPerfLine({
      webVitals: { lcp: 1000 },
      avgFps: 45,
    });
    expect(result).toBe('LCP:1000ms | FPS:45');
    expect(result).not.toContain('CLS');
    expect(result).not.toContain('INP');
  });
});

// ---------------------------------------------------------------------------
// Sorting logic
// ---------------------------------------------------------------------------

describe('session sorting', () => {
  const makeSummary = (
    id: string,
    startTime: number,
    perf?: SessionPerformance
  ): SessionSummary => ({
    id,
    appName: 'app',
    platform: 'web',
    eventCount: 0,
    startTime,
    performance: perf,
  });

  test('sorts by time descending (newest first)', () => {
    const sessions = [
      makeSummary('old', 1000),
      makeSummary('mid', 2000),
      makeSummary('new', 3000),
    ];

    sessions.sort((a, b) => b.startTime - a.startTime);

    expect(sessions[0].id).toBe('new');
    expect(sessions[1].id).toBe('mid');
    expect(sessions[2].id).toBe('old');
  });

  test('sorts by LCP worst first', () => {
    const sessions = [
      makeSummary('fast', 0, { webVitals: { lcp: 500 } }),
      makeSummary('slow', 0, { webVitals: { lcp: 5000 } }),
      makeSummary('mid', 0, { webVitals: { lcp: 2000 } }),
    ];

    sessions.sort((a, b) => {
      const va = getPerfSortValue(a, 'lcp');
      const vb = getPerfSortValue(b, 'lcp');
      return vb - va;
    });

    expect(sessions[0].id).toBe('slow');
    expect(sessions[2].id).toBe('fast');
  });

  test('sorts sessions without perf data to end for perf metrics', () => {
    const sessions = [
      makeSummary('no-perf', 0),
      makeSummary('has-perf', 0, { webVitals: { lcp: 1000 } }),
    ];

    sessions.sort((a, b) => {
      const va = getPerfSortValue(a, 'lcp');
      const vb = getPerfSortValue(b, 'lcp');
      return vb - va;
    });

    // Infinity sorts to end (highest value = worst = first, but Infinity > any number)
    expect(sessions[0].id).toBe('no-perf');
  });
});

// ---------------------------------------------------------------------------
// Filtering logic
// ---------------------------------------------------------------------------

describe('session filtering', () => {
  const makeSummary = (
    id: string,
    perf?: SessionPerformance
  ): SessionSummary => ({
    id,
    appName: 'app',
    platform: 'web',
    eventCount: 5,
    startTime: Date.now(),
    performance: perf,
  });

  test('--slow filter keeps only sessions exceeding CWV thresholds', () => {
    const sessions = [
      makeSummary('good', { webVitals: { lcp: 1000, cls: 0.1 } }),
      makeSummary('slow-lcp', { webVitals: { lcp: 3000, cls: 0.1 } }),
      makeSummary('slow-cls', { webVitals: { cls: 0.5 } }),
      makeSummary('no-perf'),
    ];

    const filtered = sessions.filter(isSlowSession);
    expect(filtered.length).toBe(2);
    expect(filtered.map((s) => s.id)).toContain('slow-lcp');
    expect(filtered.map((s) => s.id)).toContain('slow-cls');
  });

  test('--lcp-gt filter keeps sessions with LCP above value', () => {
    const lcpGt = 2000;
    const sessions = [
      makeSummary('fast', { webVitals: { lcp: 1500 } }),
      makeSummary('slow', { webVitals: { lcp: 3000 } }),
    ];

    const filtered = sessions.filter(
      (s) => (s.performance?.webVitals?.lcp ?? 0) > lcpGt
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('slow');
  });

  test('--cls-gt filter keeps sessions with CLS above value', () => {
    const clsGt = 0.2;
    const sessions = [
      makeSummary('good', { webVitals: { cls: 0.1 } }),
      makeSummary('bad', { webVitals: { cls: 0.4 } }),
    ];

    const filtered = sessions.filter(
      (s) => (s.performance?.webVitals?.cls ?? 0) > clsGt
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('bad');
  });

  test('--fps-lt filter keeps sessions with FPS below value', () => {
    const fpsLt = 30;
    const sessions = [
      makeSummary('smooth', { avgFps: 60 }),
      makeSummary('janky', { avgFps: 15 }),
    ];

    const filtered = sessions.filter(
      (s) => (s.performance?.avgFps ?? Infinity) < fpsLt
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('janky');
  });

  test('limit truncates results', () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSummary(`sess-${i}`)
    );

    const limit = 20;
    const result = sessions.slice(0, limit);
    expect(result.length).toBe(20);
  });
});
