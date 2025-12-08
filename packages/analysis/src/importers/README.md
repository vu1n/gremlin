# Gremlin Session Importers

Importers for converting session recordings from various platforms to GremlinSession format.

## Available Importers

### RRWeb Importer (Generic)

The `rrweb` importer is a generic adapter that can import rrweb recordings from any source:
- Direct rrweb recordings
- PostHog session exports
- Logrocket exports
- FullStory exports
- Any other tool that uses rrweb format

**Key Features:**
- Converts rrweb events to GremlinSession format
- Extracts user interactions (clicks, scrolls, inputs)
- Builds element dictionary from DOM snapshots
- Supports delta-encoded timestamps
- Optional input masking for PII protection
- Console error tracking

**Usage:**

```typescript
import {
  importRrwebRecording,
  parseRrwebFile,
  RrwebEventType,
  IncrementalSource,
  MouseInteractions,
  type RrwebEvent,
} from '@gremlin/core';

// Import from event array
const events: RrwebEvent[] = [
  {
    type: RrwebEventType.Meta,
    timestamp: Date.now(),
    data: {
      href: 'https://example.com',
      width: 1920,
      height: 1080,
    },
  },
  // ... more events
];

const session = importRrwebRecording(events, {
  sessionId: 'custom-id', // Optional
  app: { name: 'MyApp', version: '1.0.0' }, // Optional
  device: { osVersion: 'macOS 14.0' }, // Optional
  maskInputs: true, // Mask password inputs
  includeConsoleErrors: true, // Include console.error events
});

// Import from JSON file
const jsonContent = await Bun.file('recording.json').text();
const session2 = parseRrwebFile(jsonContent, options);

// Use importer instance for multiple recordings
import { createRrwebImporter } from '@gremlin/core';

const importer = createRrwebImporter({
  app: { name: 'MyApp', version: '1.0.0' },
  maskInputs: true,
});

const recordings = [events1, events2, events3];
const sessions = recordings.map((r) => importer.importRecording(r));
```

**Supported Event Types:**

The importer converts these rrweb event types to Gremlin events:

| rrweb Event | Gremlin Event | Description |
|-------------|---------------|-------------|
| Meta | Navigation | Page navigation |
| MouseInteraction (Click) | Tap | Mouse clicks |
| MouseInteraction (DblClick) | DoubleTap | Double clicks |
| MouseInteraction (TouchEnd) | Tap | Touch events |
| Scroll | Scroll | Scroll events |
| Input | Input | Input field changes |
| Log (error) | Error | Console errors |

**Element Extraction:**

The importer builds an element dictionary from DOM snapshots, extracting:
- Test IDs (`data-testid`, `data-test`)
- Accessibility labels (`aria-label`, `aria-labelledby`)
- Text content
- CSS selectors (tag + id + classes)
- Element attributes

### PostHog Importer

The `posthog` importer provides direct integration with PostHog's API to fetch and import session recordings.

**Usage:**

```typescript
import {
  createPostHogImporter,
  importRecording,
  type PostHogConfig,
} from '@gremlin/core';

const config: PostHogConfig = {
  apiKey: 'phc_...',
  projectId: '12345',
  baseUrl: 'https://app.posthog.com', // Optional
};

// List recordings
const importer = createPostHogImporter(config);
const recordings = await importer.listRecordings({
  limit: 10,
  dateFrom: new Date('2024-01-01'),
  dateTo: new Date('2024-12-31'),
});

// Import a specific recording
const session = await importRecording(config, 'recording-id');

// Import multiple recordings
import { importRecordings } from '@gremlin/core';

const sessions = await importRecordings(config, {
  limit: 50,
  durationMin: 10, // At least 10 seconds
  durationMax: 300, // At most 5 minutes
});
```

**Note:** PostHog uses rrweb internally, so the PostHog importer leverages the generic rrweb importer for conversion.

## Output Format

All importers convert recordings to the `GremlinSession` format:

```typescript
interface GremlinSession {
  header: {
    sessionId: string;
    startTime: number;
    endTime?: number;
    device: DeviceInfo;
    app: AppInfo;
    schemaVersion: number;
  };
  elements: ElementInfo[]; // Element dictionary
  events: GremlinEvent[]; // Delta-encoded events
  screenshots: Screenshot[];
}
```

See [session types](../session/types.ts) for complete format documentation.

## Using Imported Sessions

Once imported, sessions can be used with Gremlin's test generators:

```typescript
import {
  importRrwebRecording,
  generatePlaywrightTest,
  generateCypressTest,
} from '@gremlin/core';

// Import session
const session = importRrwebRecording(events);

// Generate tests
const playwrightTest = generatePlaywrightTest(session);
const cypressTest = generateCypressTest(session);

// Write to files
await Bun.write('tests/recording.spec.ts', playwrightTest);
await Bun.write('cypress/e2e/recording.cy.ts', cypressTest);
```

## Importing from Other Sources

If your tool exports in a different format, you can either:

1. **Convert to rrweb format first** - Most session replay tools can export to rrweb format
2. **Create a custom importer** - Follow the pattern in `rrweb.ts` or `posthog.ts`

Example custom importer structure:

```typescript
import type { GremlinSession } from '@gremlin/core';

export function importCustomFormat(data: CustomFormat): GremlinSession {
  // 1. Create session with header
  const session: GremlinSession = {
    header: {
      sessionId: data.id,
      startTime: data.timestamp,
      device: extractDeviceInfo(data),
      app: extractAppInfo(data),
      schemaVersion: 1,
    },
    elements: [],
    events: [],
    screenshots: [],
  };

  // 2. Extract and convert events
  for (const event of data.events) {
    convertEvent(event, session);
  }

  return session;
}
```

## Related Documentation

- [Session Types](../session/types.ts) - GremlinSession format specification
- [Test Generators](../generators/) - Generate tests from sessions
- [rrweb Documentation](https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/dive-into-event.md) - rrweb event format reference
