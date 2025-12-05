# Integration Guide

Guide for integrating `@gremlin/proto` with other Gremlin packages.

## Installation

From the monorepo root:

```bash
# The proto package is already set up
cd packages/proto

# Install dependencies (if needed)
bun install

# Generate TypeScript from .proto files
bun run generate

# Build the package
bun run build

# Run tests
bun test
```

## Using in Other Packages

### Add Dependency

In another package's `package.json`:

```json
{
  "dependencies": {
    "@gremlin/proto": "workspace:*"
  }
}
```

### Import and Use

```typescript
import {
  encodeSession,
  decodeSession,
  toProtoSession,
  fromProtoSession,
  type ProtoSession,
} from '@gremlin/proto';

// Import generated types directly
import { Platform, EventTypeEnum } from '@gremlin/proto/generated';
```

## Integration with @gremlin/core

### Converting Core Types to Proto

The proto types closely match the core types in `@gremlin/core/session/types.ts`. The main differences:

1. **Timestamps**: Core uses `number`, proto uses `BigInt` (uint64)
2. **Enums**: Core uses string literals, proto uses integer enums
3. **Optional fields**: Both use optional, but syntax differs

#### Example Conversion

```typescript
import type { GremlinSession } from '@gremlin/core/session/types';
import { encodeSession, type ProtoSession } from '@gremlin/proto';
import { Platform, EventTypeEnum, ElementType } from '@gremlin/proto/generated';

function convertCoreToProto(coreSession: GremlinSession): ProtoSession {
  return {
    header: {
      sessionId: coreSession.header.sessionId,
      startTime: BigInt(coreSession.header.startTime),
      endTime: coreSession.header.endTime
        ? BigInt(coreSession.header.endTime)
        : undefined,
      schemaVersion: coreSession.header.schemaVersion,
      device: {
        platform: platformToProto(coreSession.header.device.platform),
        osVersion: coreSession.header.device.osVersion,
        model: coreSession.header.device.model,
        screen: coreSession.header.device.screen,
        userAgent: coreSession.header.device.userAgent,
        locale: coreSession.header.device.locale,
      },
      app: coreSession.header.app,
    },
    elements: coreSession.elements.map(convertElement),
    events: coreSession.events.map(convertEvent),
    screenshots: coreSession.screenshots.map(convertScreenshot),
  };
}

function platformToProto(platform: 'web' | 'ios' | 'android'): Platform {
  switch (platform) {
    case 'web': return Platform.PLATFORM_WEB;
    case 'ios': return Platform.PLATFORM_IOS;
    case 'android': return Platform.PLATFORM_ANDROID;
  }
}

function convertElement(element: any) {
  return {
    testId: element.testId,
    accessibilityLabel: element.accessibilityLabel,
    text: element.text,
    type: elementTypeToProto(element.type),
    bounds: element.bounds,
    cssSelector: element.cssSelector,
    attributes: element.attributes,
  };
}

function elementTypeToProto(type: string): ElementType {
  // Map string to enum
  const map: Record<string, ElementType> = {
    button: ElementType.ELEMENT_TYPE_BUTTON,
    link: ElementType.ELEMENT_TYPE_LINK,
    input: ElementType.ELEMENT_TYPE_INPUT,
    text: ElementType.ELEMENT_TYPE_TEXT,
    image: ElementType.ELEMENT_TYPE_IMAGE,
    container: ElementType.ELEMENT_TYPE_CONTAINER,
    scroll_view: ElementType.ELEMENT_TYPE_SCROLL_VIEW,
    list: ElementType.ELEMENT_TYPE_LIST,
    list_item: ElementType.ELEMENT_TYPE_LIST_ITEM,
    modal: ElementType.ELEMENT_TYPE_MODAL,
    pressable: ElementType.ELEMENT_TYPE_PRESSABLE,
    touchable: ElementType.ELEMENT_TYPE_TOUCHABLE,
  };
  return map[type] ?? ElementType.ELEMENT_TYPE_UNKNOWN;
}

function convertEvent(event: any) {
  const protoEvent: any = {
    dt: event.dt,
    type: eventTypeToProto(event.type),
    perf: event.perf,
  };

  // Convert event data based on type
  switch (event.type) {
    case EventTypeEnum.TAP:
    case EventTypeEnum.DOUBLE_TAP:
    case EventTypeEnum.LONG_PRESS:
      protoEvent.tap = event.data;
      break;
    case EventTypeEnum.SWIPE:
      protoEvent.swipe = event.data;
      break;
    case EventTypeEnum.SCROLL:
      protoEvent.scroll = event.data;
      break;
    case EventTypeEnum.INPUT:
      protoEvent.input = event.data;
      break;
    case EventTypeEnum.NAVIGATION:
      protoEvent.navigation = {
        ...event.data,
        paramsJson: event.data.params
          ? JSON.stringify(event.data.params)
          : undefined,
      };
      break;
    case EventTypeEnum.NETWORK:
      protoEvent.network = event.data;
      break;
    case EventTypeEnum.SCREEN_CAPTURE:
      protoEvent.screenCapture = event.data;
      break;
    case EventTypeEnum.ERROR:
      protoEvent.error = event.data;
      break;
    case EventTypeEnum.APP_STATE:
      protoEvent.appState = event.data;
      break;
  }

  return protoEvent;
}

function eventTypeToProto(type: number): EventTypeEnum {
  return type as EventTypeEnum;
}

function convertScreenshot(screenshot: any) {
  return {
    id: screenshot.id,
    timestamp: BigInt(screenshot.timestamp),
    format: imageFormatToProto(screenshot.format),
    data: screenshot.data,
    isUrl: screenshot.isUrl,
    width: screenshot.width,
    height: screenshot.height,
    quality: screenshot.quality,
    isDiff: screenshot.isDiff,
    diffFromId: screenshot.diffFromId,
  };
}

function imageFormatToProto(format: string) {
  // Map to ImageFormat enum
  const map: Record<string, number> = {
    webp: 0,
    jpeg: 1,
    png: 2,
  };
  return map[format] ?? 0;
}
```

## Integration with @gremlin/server

### Storing Sessions in Database

```typescript
import { encodeSession } from '@gremlin/proto';
import { gzipSync } from 'zlib';

async function storeSession(session: GremlinSession) {
  // Convert to proto
  const protoSession = convertCoreToProto(session);

  // Encode to binary
  const binary = encodeSession(protoSession);

  // Compress
  const compressed = gzipSync(binary);

  // Store in database
  await db.sessions.create({
    id: session.header.sessionId,
    data: compressed,
    size: compressed.length,
    created_at: new Date(Number(session.header.startTime)),
  });
}
```

### Retrieving Sessions

```typescript
import { decodeSession } from '@gremlin/proto';
import { gunzipSync } from 'zlib';

async function retrieveSession(sessionId: string): Promise<GremlinSession> {
  // Fetch from database
  const row = await db.sessions.findById(sessionId);

  // Decompress
  const binary = gunzipSync(row.data);

  // Decode from proto
  const protoSession = decodeSession(binary);

  // Convert back to core types
  return convertProtoToCore(protoSession);
}
```

## Integration with @gremlin/recorder-*

### Recording to Proto Format

Recorders can encode sessions on-the-fly:

```typescript
import { encodeSession } from '@gremlin/proto';

class ProtoRecorder {
  private session: GremlinSession;

  recordEvent(event: GremlinEvent) {
    this.session.events.push(event);
  }

  async flush() {
    // Convert to proto
    const protoSession = convertCoreToProto(this.session);

    // Encode
    const binary = encodeSession(protoSession);

    // Send to server
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: binary,
    });
  }
}
```

### Streaming Proto Data

For long sessions, stream events incrementally:

```typescript
// Note: This requires extending the proto format to support streaming
// Current implementation encodes the full session at once

// Future: Use protobuf delimited messages
import { GremlinEvent } from '@gremlin/proto/generated';

function* streamEvents(events: GremlinEvent[]) {
  for (const event of events) {
    const binary = GremlinEvent.encode(event).finish();
    const length = binary.length;

    // Delimited format: varint length + message
    yield encodeVarint(length);
    yield binary;
  }
}
```

## Performance Considerations

### Memory Usage

Encoding is memory-efficient:

```typescript
// ✅ Good: Encode once
const binary = encodeSession(session);
await storeInDatabase(binary);

// ❌ Bad: Keep both representations in memory
const json = JSON.stringify(session);  // ~500 KB
const binary = encodeSession(session); // ~100 KB
// Total: 600 KB in memory
```

### Batch Processing

For large batches, process in chunks:

```typescript
async function encodeSessions(sessions: GremlinSession[]) {
  const CHUNK_SIZE = 100;

  for (let i = 0; i < sessions.length; i += CHUNK_SIZE) {
    const chunk = sessions.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (session) => {
        const binary = encodeSession(convertCoreToProto(session));
        await store(binary);
      })
    );

    // Allow GC to reclaim memory
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

## Testing

### Unit Tests

```typescript
import { describe, test, expect } from 'bun:test';
import { encodeSession, decodeSession } from '@gremlin/proto';

describe('Session serialization', () => {
  test('roundtrip', () => {
    const original = createTestSession();
    const binary = encodeSession(convertCoreToProto(original));
    const decoded = convertProtoToCore(decodeSession(binary));

    expect(decoded).toEqual(original);
  });

  test('compression ratio', () => {
    const session = createLargeSession(1000); // 1000 events
    const binary = encodeSession(convertCoreToProto(session));
    const json = JSON.stringify(session);

    const ratio = binary.length / json.length;
    expect(ratio).toBeLessThan(0.2); // At least 5x compression
  });
});
```

### Integration Tests

```typescript
test('end-to-end storage', async () => {
  // Record session
  const recorder = new ProtoRecorder();
  recorder.recordTap(100, 200, 0);
  recorder.recordNavigation('Profile');

  // Encode and store
  const binary = recorder.encode();
  await db.store(binary);

  // Retrieve and decode
  const retrieved = await db.retrieve();
  const session = decodeSession(retrieved);

  expect(session.events).toHaveLength(2);
});
```

## Troubleshooting

### Common Issues

#### Issue: "Cannot serialize BigInt"

**Problem**: Trying to JSON.stringify proto types

**Solution**: Use custom replacer

```typescript
JSON.stringify(protoSession, (_, value) =>
  typeof value === 'bigint' ? value.toString() : value
);
```

#### Issue: "Type mismatch on enum values"

**Problem**: Core types use string literals, proto uses integers

**Solution**: Use conversion functions (see example above)

#### Issue: "Generated types not found"

**Problem**: Forgot to run `bun run generate`

**Solution**:

```bash
cd packages/proto
bun run generate
```

#### Issue: "Decode error: invalid wire type"

**Problem**: Trying to decode non-proto data

**Solution**: Ensure data is protobuf-encoded

```typescript
// Check magic bytes (optional)
function isProtoBuffer(data: Uint8Array): boolean {
  // Protobuf doesn't have magic bytes, but can check structure
  return data.length > 0 && data[0] < 0x20;
}
```

## Next Steps

1. **Implement conversion utilities**: Create `@gremlin/proto/converters` module
2. **Add streaming support**: Extend proto format for incremental encoding
3. **Benchmark real sessions**: Measure compression on production data
4. **Add schema migration**: Support multiple schema versions

## Resources

- [Proto Package README](./README.md)
- [Wire Format Specification](./WIRE_FORMAT.md)
- [Protocol Buffers Guide](https://protobuf.dev)
- [ts-proto Documentation](https://github.com/stephenh/ts-proto)
