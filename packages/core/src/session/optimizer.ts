/**
 * Session optimizer - Compression and optimization for GremlinSession
 *
 * Optimizations applied:
 * 1. Delta time encoding (already in GremlinEvent.dt)
 * 2. Element dictionary deduplication (already in GremlinSession.elements)
 * 3. Varint encoding for integers (coordinates, indices, timestamps)
 * 4. MessagePack binary serialization
 * 5. Gzip compression
 *
 * Target: 10-50x reduction vs naive JSON
 */

import { gunzipSync, gzipSync } from 'zlib';
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';
import type { GremlinSession, GremlinEvent, ElementInfo, Rect } from './types.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Optimized session format with varint-encoded integers.
 * This intermediate format is then serialized with MessagePack.
 */
export interface OptimizedSession {
  /** Session header (mostly strings, limited optimization) */
  header: GremlinSession['header'];

  /** Element dictionary - optimized with coordinate varints */
  elements: OptimizedElement[];

  /** Events - optimized with varint encoding */
  events: OptimizedEvent[];

  /** Screenshots (stored separately in production, but included here) */
  screenshots: GremlinSession['screenshots'];
}

export interface OptimizedElement {
  /** Test ID (best for test generation) */
  testId?: string;

  /** Accessibility label */
  accessibilityLabel?: string;

  /** Visible text content */
  text?: string;

  /** Element type (enum as number) */
  type: number;

  /** Bounding rectangle - varint encoded */
  bounds?: number[]; // [x, y, width, height]

  /** CSS selector (web only) */
  cssSelector?: string;

  /** Additional attributes */
  attributes?: Record<string, string>;
}

export interface OptimizedEvent {
  /** Delta time from previous event (ms) - varint encoded */
  dt: number;

  /** Event type (enum, already a number) */
  type: number;

  /** Event-specific data - varint encoded coordinates */
  data: OptimizedEventData;

  /** Performance sample - varint encoded metrics */
  perf?: OptimizedPerformanceSample;
}

type OptimizedEventData = Record<string, unknown>;

export interface OptimizedPerformanceSample {
  /** Frames per second (stored as int, fps * 10 for precision) */
  fps?: number;

  /** JS thread blocked time (ms) */
  jsThreadLag?: number;

  /** Memory usage (MB, stored as KB for precision) */
  memoryUsage?: number;

  /** Time since last navigation (ms) */
  timeSinceNavigation?: number;
}

export interface CompressionStats {
  /** Original size (bytes) */
  originalSize: number;

  /** Optimized size before compression (bytes) */
  optimizedSize: number;

  /** Final compressed size (bytes) */
  compressedSize: number;

  /** Compression ratio (original / compressed) */
  compressionRatio: number;

  /** Optimization ratio (original / optimized) */
  optimizationRatio: number;

  /** Final ratio (original / compressed) */
  finalRatio: number;

  /** Breakdown by section */
  breakdown: {
    header: number;
    elements: number;
    events: number;
    screenshots: number;
  };
}

// ============================================================================
// Element Type Mapping
// ============================================================================

const ELEMENT_TYPE_TO_NUMBER: Record<string, number> = {
  button: 0,
  link: 1,
  input: 2,
  text: 3,
  image: 4,
  container: 5,
  scroll_view: 6,
  list: 7,
  list_item: 8,
  modal: 9,
  pressable: 10,
  touchable: 11,
  unknown: 12,
};

const NUMBER_TO_ELEMENT_TYPE: Record<number, string> = Object.fromEntries(
  Object.entries(ELEMENT_TYPE_TO_NUMBER).map(([k, v]) => [v, k])
);

// ============================================================================
// Varint Encoding Helpers
// ============================================================================

/**
 * Convert coordinates and dimensions to varints.
 * These are typically small positive integers, perfect for varint encoding.
 * We round to integers to enable varint encoding (0.5px precision is irrelevant).
 */
function encodeRect(rect: Rect): number[] {
  return [
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height),
  ];
}

function decodeRect(encoded: number[]): Rect {
  return {
    x: encoded[0],
    y: encoded[1],
    width: encoded[2],
    height: encoded[3],
  };
}

/**
 * Encode coordinates in event data.
 * Modifies object in place for efficiency.
 */
function encodeEventCoordinates(data: Record<string, unknown>): OptimizedEventData {
  const optimized = { ...data };

  // Round all coordinate and dimension values
  if (typeof optimized.x === 'number') optimized.x = Math.round(optimized.x);
  if (typeof optimized.y === 'number') optimized.y = Math.round(optimized.y);
  if (typeof optimized.startX === 'number') optimized.startX = Math.round(optimized.startX);
  if (typeof optimized.startY === 'number') optimized.startY = Math.round(optimized.startY);
  if (typeof optimized.endX === 'number') optimized.endX = Math.round(optimized.endX);
  if (typeof optimized.endY === 'number') optimized.endY = Math.round(optimized.endY);
  if (typeof optimized.deltaX === 'number') optimized.deltaX = Math.round(optimized.deltaX);
  if (typeof optimized.deltaY === 'number') optimized.deltaY = Math.round(optimized.deltaY);
  if (typeof optimized.duration === 'number') optimized.duration = Math.round(optimized.duration);

  return optimized;
}

/**
 * Encode performance sample with precision optimization.
 */
function encodePerformanceSample(
  perf: GremlinEvent['perf']
): OptimizedPerformanceSample | undefined {
  if (!perf) return undefined;

  return {
    // FPS * 10 for 0.1 precision (e.g., 59.7 fps -> 597)
    fps: perf.fps !== undefined ? Math.round(perf.fps * 10) : undefined,
    // Round to integer ms
    jsThreadLag: perf.jsThreadLag !== undefined ? Math.round(perf.jsThreadLag) : undefined,
    // MB -> KB for better precision (e.g., 45.2 MB -> 45200 KB)
    memoryUsage: perf.memoryUsage !== undefined ? Math.round(perf.memoryUsage * 1000) : undefined,
    // Round to integer ms
    timeSinceNavigation:
      perf.timeSinceNavigation !== undefined ? Math.round(perf.timeSinceNavigation) : undefined,
  };
}

/**
 * Decode performance sample.
 */
function decodePerformanceSample(
  perf: OptimizedPerformanceSample | undefined
): GremlinEvent['perf'] {
  if (!perf) return undefined;

  return {
    fps: perf.fps !== undefined ? perf.fps / 10 : undefined,
    jsThreadLag: perf.jsThreadLag,
    memoryUsage: perf.memoryUsage !== undefined ? perf.memoryUsage / 1000 : undefined,
    timeSinceNavigation: perf.timeSinceNavigation,
  };
}

// ============================================================================
// Core Optimization Functions
// ============================================================================

/**
 * Optimize a session for compression.
 *
 * Optimizations:
 * - Convert element types to numbers
 * - Encode coordinates/dimensions as integers (varints)
 * - Encode performance metrics with appropriate precision
 */
export function optimizeSession(session: GremlinSession): OptimizedSession {
  return {
    header: session.header,
    elements: session.elements.map(optimizeElement),
    events: session.events.map(optimizeEvent),
    screenshots: session.screenshots,
  };
}

function optimizeElement(element: ElementInfo): OptimizedElement {
  return {
    testId: element.testId,
    accessibilityLabel: element.accessibilityLabel,
    text: element.text,
    type: ELEMENT_TYPE_TO_NUMBER[element.type] ?? 12, // default to 'unknown'
    bounds: element.bounds ? encodeRect(element.bounds) : undefined,
    cssSelector: element.cssSelector,
    attributes: element.attributes,
  };
}

function optimizeEvent(event: GremlinEvent): OptimizedEvent {
  return {
    dt: Math.round(event.dt),
    type: event.type,
    data: encodeEventCoordinates(event.data as unknown as Record<string, unknown>),
    perf: encodePerformanceSample(event.perf),
  };
}

/**
 * Restore original session from optimized format.
 */
export function deoptimizeSession(optimized: OptimizedSession): GremlinSession {
  return {
    header: optimized.header,
    elements: optimized.elements.map(deoptimizeElement),
    events: optimized.events.map(deoptimizeEvent),
    screenshots: optimized.screenshots,
  };
}

function deoptimizeElement(element: OptimizedElement): ElementInfo {
  return {
    testId: element.testId,
    accessibilityLabel: element.accessibilityLabel,
    text: element.text,
    type: (NUMBER_TO_ELEMENT_TYPE[element.type] ?? 'unknown') as ElementInfo['type'],
    bounds: element.bounds ? decodeRect(element.bounds) : undefined,
    cssSelector: element.cssSelector,
    attributes: element.attributes,
  };
}

function deoptimizeEvent(event: OptimizedEvent): GremlinEvent {
  return {
    dt: event.dt,
    type: event.type,
    data: event.data as unknown as GremlinEvent['data'],
    perf: decodePerformanceSample(event.perf),
  };
}

// ============================================================================
// Compression Functions
// ============================================================================

/**
 * Compress a session to a binary buffer.
 *
 * Process:
 * 1. Optimize session (varints, type encoding)
 * 2. Serialize with MessagePack (efficient binary format)
 * 3. Compress with Gzip
 */
export function compressSession(session: GremlinSession): Buffer {
  // Step 1: Optimize
  const optimized = optimizeSession(session);

  // Step 2: MessagePack encode
  const msgpack = msgpackEncode(optimized);

  // Step 3: Gzip compress
  const compressed = gzipSync(msgpack, {
    level: 9, // Maximum compression
  });

  return Buffer.from(compressed);
}

/**
 * Decompress a session from a binary buffer.
 *
 * Process:
 * 1. Gunzip decompress
 * 2. MessagePack decode
 * 3. Deoptimize (restore original types)
 */
export function decompressSession(buffer: Buffer): GremlinSession {
  // Step 1: Gunzip
  const msgpack = gunzipSync(buffer);

  // Step 2: MessagePack decode
  const optimized = msgpackDecode(msgpack) as OptimizedSession;

  // Step 3: Deoptimize
  return deoptimizeSession(optimized);
}

// ============================================================================
// Benchmarking
// ============================================================================

/**
 * Measure compression ratio and breakdown.
 */
export function measureCompression(session: GremlinSession): CompressionStats {
  // Original size (naive JSON)
  const originalJson = JSON.stringify(session);
  const originalSize = Buffer.from(originalJson).length;

  // Optimized size (MessagePack without gzip)
  const optimized = optimizeSession(session);
  const optimizedMsgpack = msgpackEncode(optimized);
  const optimizedSize = optimizedMsgpack.length;

  // Final compressed size
  const compressed = compressSession(session);
  const compressedSize = compressed.length;

  // Breakdown by section
  const headerSize = Buffer.from(JSON.stringify(session.header)).length;
  const elementsSize = Buffer.from(JSON.stringify(session.elements)).length;
  const eventsSize = Buffer.from(JSON.stringify(session.events)).length;
  const screenshotsSize = Buffer.from(JSON.stringify(session.screenshots)).length;

  return {
    originalSize,
    optimizedSize,
    compressedSize,
    compressionRatio: originalSize / compressedSize,
    optimizationRatio: originalSize / optimizedSize,
    finalRatio: originalSize / compressedSize,
    breakdown: {
      header: headerSize,
      elements: elementsSize,
      events: eventsSize,
      screenshots: screenshotsSize,
    },
  };
}

/**
 * Format compression stats for display.
 */
export function formatCompressionStats(stats: CompressionStats): string {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatRatio = (ratio: number) => `${ratio.toFixed(2)}x`;

  return `
Compression Statistics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Original (JSON):     ${formatBytes(stats.originalSize)}
Optimized (MsgPack): ${formatBytes(stats.optimizedSize)} (${formatRatio(stats.optimizationRatio)} reduction)
Compressed (Gzip):   ${formatBytes(stats.compressedSize)} (${formatRatio(stats.compressionRatio)} reduction)

Final Ratio:         ${formatRatio(stats.finalRatio)}

Breakdown (Original):
  Header:      ${formatBytes(stats.breakdown.header)}
  Elements:    ${formatBytes(stats.breakdown.elements)}
  Events:      ${formatBytes(stats.breakdown.events)}
  Screenshots: ${formatBytes(stats.breakdown.screenshots)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}
