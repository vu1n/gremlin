/**
 * Cycle Detector - Detect cycles in session navigation data
 */

import type { GremlinSession } from '@gremlin/core';
import { EventTypeEnum } from '@gremlin/core';
import type { NavigationEvent } from '@gremlin/core';

/**
 * Type of cycle detected
 */
export type CycleType = 'navigation' | 'state' | 'error';

/**
 * Information about a detected cycle
 */
export interface CycleInfo {
  /** Cycle type */
  type: CycleType;

  /** States/screens in the cycle */
  path: string[];

  /** How many times this cycle occurred */
  frequency: number;

  /** Average iterations per occurrence */
  avgIterations: number;

  /** Maximum iterations observed */
  maxIterations: number;

  /** Session IDs where this cycle was observed */
  sessionIds: string[];

  /** Example timestamps */
  exampleTimestamps: number[];
}

/**
 * Cycle occurrence during session analysis
 */
interface CycleOccurrence {
  path: string[];
  iterations: number;
  sessionId: string;
  timestamp: number;
  hasErrors: boolean;
}

/**
 * Detect cycles in session navigation data
 */
export function detectCycles(sessions: GremlinSession[]): CycleInfo[] {
  const occurrences: CycleOccurrence[] = [];

  for (const session of sessions) {
    const sessionOccurrences = detectCyclesInSession(session);
    occurrences.push(...sessionOccurrences);
  }

  // Group occurrences by cycle pattern
  const cycleMap = new Map<string, CycleOccurrence[]>();

  for (const occurrence of occurrences) {
    const key = getCycleKey(occurrence.path);
    if (!cycleMap.has(key)) {
      cycleMap.set(key, []);
    }
    cycleMap.get(key)!.push(occurrence);
  }

  // Convert to CycleInfo
  const cycles: CycleInfo[] = [];

  for (const [key, group] of cycleMap) {
    const iterations = group.map(o => o.iterations);
    const avgIterations = iterations.reduce((a, b) => a + b, 0) / iterations.length;
    const maxIterations = Math.max(...iterations);

    const hasErrors = group.some(o => o.hasErrors);
    const type = classifyCycle(group[0].path, hasErrors);

    cycles.push({
      type,
      path: group[0].path,
      frequency: group.length,
      avgIterations: Math.round(avgIterations * 10) / 10,
      maxIterations,
      sessionIds: [...new Set(group.map(o => o.sessionId))],
      exampleTimestamps: group.slice(0, 3).map(o => o.timestamp),
    });
  }

  // Sort by frequency (most common first)
  cycles.sort((a, b) => b.frequency - a.frequency);

  return cycles;
}

/**
 * Detect cycles within a single session
 */
function detectCyclesInSession(session: GremlinSession): CycleOccurrence[] {
  const occurrences: CycleOccurrence[] = [];
  const navigationPath: string[] = [];
  const timestamps: number[] = [];
  const errorScreens = new Set<string>();

  let currentTimestamp = session.header.startTime;

  // Build navigation path and track errors
  for (const event of session.events) {
    currentTimestamp += event.dt;

    if (event.type === EventTypeEnum.NAVIGATION) {
      const navEvent = event.data as NavigationEvent;
      navigationPath.push(navEvent.screen);
      timestamps.push(currentTimestamp);
    }

    if (event.type === EventTypeEnum.ERROR) {
      // Track which screen had errors
      if (navigationPath.length > 0) {
        errorScreens.add(navigationPath[navigationPath.length - 1]);
      }
    }
  }

  // Find cycles in the navigation path
  for (let start = 0; start < navigationPath.length; start++) {
    const cycles = findCyclesFrom(navigationPath, start);

    for (const cycle of cycles) {
      const hasErrors = cycle.path.some(screen => errorScreens.has(screen));

      occurrences.push({
        path: cycle.path,
        iterations: cycle.iterations,
        sessionId: session.header.sessionId,
        timestamp: timestamps[start] ?? currentTimestamp,
        hasErrors,
      });
    }
  }

  return occurrences;
}

/**
 * Find cycles starting from a given index in the path
 */
function findCyclesFrom(
  path: string[],
  startIndex: number
): Array<{ path: string[]; iterations: number }> {
  const results: Array<{ path: string[]; iterations: number }> = [];

  // Look for repeating patterns of length 2 to 10
  for (let patternLength = 2; patternLength <= 10 && startIndex + patternLength <= path.length; patternLength++) {
    const pattern = path.slice(startIndex, startIndex + patternLength);

    // Count how many times this pattern repeats
    let iterations = 1;
    let pos = startIndex + patternLength;

    while (pos + patternLength <= path.length) {
      const nextSegment = path.slice(pos, pos + patternLength);

      if (arraysEqual(pattern, nextSegment)) {
        iterations++;
        pos += patternLength;
      } else {
        break;
      }
    }

    // Only consider it a cycle if it repeats at least 2 times
    if (iterations >= 2) {
      results.push({
        path: pattern,
        iterations,
      });

      // Skip ahead to avoid finding overlapping cycles
      break;
    }
  }

  return results;
}

/**
 * Classify the type of cycle
 */
function classifyCycle(path: string[], hasErrors: boolean): CycleType {
  if (hasErrors) {
    return 'error';
  }

  // State cycle: same screen appears in the path (e.g., [A, B, A])
  const uniqueScreens = new Set(path);
  if (uniqueScreens.size < path.length) {
    return 'state';
  }

  // Navigation cycle: different screens but forms a cycle
  return 'navigation';
}

/**
 * Generate a unique key for a cycle pattern
 */
function getCycleKey(path: string[]): string {
  return path.join(' → ');
}

/**
 * Check if two arrays are equal
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

/**
 * Format cycles as a readable report
 */
export function formatCyclesReport(cycles: CycleInfo[]): string {
  if (cycles.length === 0) {
    return 'No cycles detected.';
  }

  const lines: string[] = [];

  lines.push(`=== Detected Cycles (${cycles.length}) ===\n`);

  for (const cycle of cycles) {
    const typeIcon = cycle.type === 'error' ? '🔴' : cycle.type === 'state' ? '🔄' : '🔁';
    const pathStr = cycle.path.join(' → ');

    lines.push(`${typeIcon} ${cycle.type.toUpperCase()}: ${pathStr}`);
    lines.push(`   Frequency: ${cycle.frequency} occurrences`);
    lines.push(`   Iterations: avg=${cycle.avgIterations}, max=${cycle.maxIterations}`);
    lines.push(`   Sessions: ${cycle.sessionIds.length} unique session(s)`);
    lines.push('');
  }

  return lines.join('\n');
}
