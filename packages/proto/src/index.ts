/**
 * @gremlin/proto - Protobuf wire format for sessions
 *
 * Provides efficient binary encoding/decoding for Gremlin sessions.
 * Achieves ~10-50x size reduction vs naive JSON (when combined with gzip).
 *
 * Usage:
 *   import { encodeSession, decodeSession } from '@gremlin/proto';
 *   import type { GremlinSession, EventTypeEnum } from '@gremlin/proto/generated';
 */

export const VERSION = '0.0.1';

import type {
  GremlinSession as ProtoSession,
  SessionHeader as ProtoHeader,
  Screenshot as ProtoScreenshot,
} from './generated/session';
import type { GremlinEvent as ProtoEvent } from './generated/events';
import type { ElementInfo as ProtoElement } from './generated/elements';

/**
 * Encode a GremlinSession to protobuf binary format
 */
export async function encodeSession(session: ProtoSession): Promise<Uint8Array> {
  const { GremlinSession } = await import('./generated/session');
  const message = GremlinSession.fromPartial(session);
  return GremlinSession.encode(message).finish();
}

/**
 * Decode a GremlinSession from protobuf binary format
 */
export async function decodeSession(data: Uint8Array): Promise<ProtoSession> {
  const { GremlinSession } = await import('./generated/session');
  return GremlinSession.decode(data);
}

/**
 * Calculate approximate compression ratio
 * Returns ratio of proto size to JSON size (lower is better)
 */
export async function estimateCompressionRatio(session: ProtoSession): Promise<number> {
  const encoded = await encodeSession(session);
  const protoSize = encoded.length;
  // Custom JSON stringify that handles BigInt
  const jsonSize = JSON.stringify(session, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ).length;
  return protoSize / jsonSize;
}

// Export type utilities
export type {
  ProtoSession,
  ProtoHeader,
  ProtoEvent,
  ProtoElement,
  ProtoScreenshot,
};
