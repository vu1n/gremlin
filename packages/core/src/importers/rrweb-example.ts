/**
 * Example usage of the rrweb importer
 *
 * This demonstrates how to import rrweb recordings from various sources:
 * 1. Direct rrweb recording data
 * 2. PostHog exports
 * 3. JSON files
 */

import {
  importRrwebRecording,
  parseRrwebFile,
  createRrwebImporter,
  RrwebEventType,
  IncrementalSource,
  MouseInteractions,
  type RrwebEvent,
  type RrwebImportOptions,
} from './rrweb.ts';

// ============================================================================
// Example 1: Import from raw rrweb events
// ============================================================================

const exampleEvents: RrwebEvent[] = [
  {
    type: RrwebEventType.Meta,
    timestamp: Date.now(),
    data: {
      href: 'https://example.com/app',
      width: 1920,
      height: 1080,
    },
  },
  {
    type: RrwebEventType.FullSnapshot,
    timestamp: Date.now() + 10,
    data: {
      node: {
        type: 1,
        id: 1,
        tagName: 'button',
        attributes: {
          'data-testid': 'submit-btn',
          class: 'btn btn-primary',
        },
        textContent: 'Submit',
      },
    },
  },
  {
    type: RrwebEventType.IncrementalSnapshot,
    timestamp: Date.now() + 1000,
    data: {
      source: IncrementalSource.MouseInteraction,
      type: MouseInteractions.Click,
      id: 1,
      x: 100,
      y: 200,
    },
  },
];

// Basic import
const session1 = importRrwebRecording(exampleEvents);
console.log('Imported session:', session1.header.sessionId);
console.log('Events:', session1.events.length);
console.log('Elements:', session1.elements.length);

// ============================================================================
// Example 2: Import with custom options
// ============================================================================

const options: RrwebImportOptions = {
  sessionId: 'custom-session-id',
  app: {
    name: 'MyApp',
    version: '2.0.0',
    identifier: 'com.example.myapp',
  },
  device: {
    osVersion: 'macOS 14.0',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    locale: 'en-US',
  },
  maskInputs: true, // Mask password fields
  includeConsoleErrors: true, // Include console.error() calls
};

const session2 = importRrwebRecording(exampleEvents, options);
console.log('Custom session:', session2.header.sessionId);

// ============================================================================
// Example 3: Import from JSON file
// ============================================================================

const jsonContent = `[
  {
    "type": 4,
    "timestamp": 1234567890000,
    "data": {
      "href": "https://example.com",
      "width": 1920,
      "height": 1080
    }
  }
]`;

const session3 = parseRrwebFile(jsonContent);
console.log('Session from JSON:', session3.header.sessionId);

// ============================================================================
// Example 4: Use importer instance for multiple recordings
// ============================================================================

const importer = createRrwebImporter({
  app: { name: 'MyApp', version: '1.0.0' },
  maskInputs: true,
});

// Process multiple recordings with the same configuration
const recordings = [exampleEvents, exampleEvents, exampleEvents];
const sessions = recordings.map((recording) =>
  importer.importRecording(recording)
);

console.log('Processed', sessions.length, 'recordings');

// ============================================================================
// Example 5: Import PostHog export
// ============================================================================

// PostHog exports are just rrweb events, so you can import them directly:
// 1. Export session from PostHog (they use rrweb internally)
// 2. Use the same importer

async function importFromPostHogExport(filePath: string) {
  const file = await Bun.file(filePath).text();
  const data = JSON.parse(file);

  // PostHog exports typically have a snapshot_data field
  const events = data.snapshot_data || data;

  return importRrwebRecording(events, {
    app: { name: 'PostHog App', version: '1.0.0' },
  });
}

// ============================================================================
// Example 6: Handle different event types
// ============================================================================

const comprehensiveEvents: RrwebEvent[] = [
  // Meta event (page navigation)
  {
    type: RrwebEventType.Meta,
    timestamp: 1000,
    data: {
      href: 'https://example.com/checkout',
      width: 1920,
      height: 1080,
    },
  },
  // Full snapshot (DOM tree)
  {
    type: RrwebEventType.FullSnapshot,
    timestamp: 1010,
    data: {
      node: {
        type: 1,
        id: 1,
        tagName: 'div',
        childNodes: [
          {
            type: 1,
            id: 2,
            tagName: 'input',
            attributes: {
              type: 'email',
              'data-testid': 'email-input',
            },
          },
          {
            type: 1,
            id: 3,
            tagName: 'button',
            attributes: {
              'data-testid': 'submit',
            },
            textContent: 'Submit Order',
          },
        ],
      },
    },
  },
  // Input event
  {
    type: RrwebEventType.IncrementalSnapshot,
    timestamp: 2000,
    data: {
      source: IncrementalSource.Input,
      id: 2,
      text: 'user@example.com',
    },
  },
  // Click event
  {
    type: RrwebEventType.IncrementalSnapshot,
    timestamp: 3000,
    data: {
      source: IncrementalSource.MouseInteraction,
      type: MouseInteractions.Click,
      id: 3,
      x: 500,
      y: 300,
    },
  },
  // Scroll event
  {
    type: RrwebEventType.IncrementalSnapshot,
    timestamp: 4000,
    data: {
      source: IncrementalSource.Scroll,
      scrollData: {
        id: 1,
        x: 0,
        y: 500,
      },
    },
  },
  // Console error
  {
    type: RrwebEventType.IncrementalSnapshot,
    timestamp: 5000,
    data: {
      source: IncrementalSource.Log,
      payload: {
        level: 'error',
        payload: ['Payment failed:', 'Network error'],
      },
    },
  },
];

const session6 = importRrwebRecording(comprehensiveEvents, {
  includeConsoleErrors: true,
});

console.log('Comprehensive session:');
console.log('  Navigation events:', session6.events.filter((e) => e.type === 6).length);
console.log('  Tap events:', session6.events.filter((e) => e.type === 0).length);
console.log('  Input events:', session6.events.filter((e) => e.type === 5).length);
console.log('  Scroll events:', session6.events.filter((e) => e.type === 4).length);
console.log('  Error events:', session6.events.filter((e) => e.type === 9).length);

// ============================================================================
// Example 7: Export session for test generation
// ============================================================================

// Once imported, you can use the session with Gremlin's test generators:
// import { generatePlaywrightTest } from '@gremlin/core';
// const testCode = generatePlaywrightTest(session1);
// console.log(testCode);
