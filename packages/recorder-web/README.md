# @gremlin/recorder-web

Web session recorder for Gremlin. Records user interactions and enriches them with element identifiers for test generation.

## Features

- **DOM Recording**: Wraps [rrweb](https://www.rrweb.io/) for full DOM replay capability
- **Element Identification**: Captures test IDs, aria-labels, and text content for reliable element selection
- **Event Enrichment**: Records clicks, inputs, scrolls, and navigation with structured data
- **Performance Metrics**: Optional performance sampling (FPS, memory, JS thread lag)
- **Delta Encoding**: Efficient timestamp encoding for minimal payload size
- **Element Dictionary**: Deduplicates element info for compact sessions

## Installation

```bash
bun add @gremlin/recorder-web
```

## Usage

### Basic Usage

```typescript
import { GremlinRecorder } from '@gremlin/recorder-web';

// Create recorder
const recorder = new GremlinRecorder({
  appName: 'MyApp',
  appVersion: '1.0.0',
});

// Start recording
recorder.start();

// ... user interacts with the page ...

// Stop and get session
const session = recorder.stop();

// Export as JSON
console.log(JSON.stringify(session));
```

### Auto-start on Page Load

```typescript
const recorder = new GremlinRecorder({
  appName: 'MyApp',
  appVersion: '1.0.0',
  autoStart: true, // Start recording when page loads
});

// Recording starts automatically
// Later, stop and retrieve session:
const session = recorder.stop();
```

### Real-time Event Streaming

```typescript
const recorder = new GremlinRecorder({
  appName: 'MyApp',
  appVersion: '1.0.0',
  onEvent: (event) => {
    // Send event to backend in real-time
    fetch('/api/gremlin/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },
});

recorder.start();
```

### Custom Configuration

```typescript
const recorder = new GremlinRecorder({
  appName: 'MyApp',
  appVersion: '1.0.0',
  appBuild: '123',

  // Performance monitoring
  capturePerformance: true,
  performanceInterval: 5000, // Sample every 5s

  // Privacy
  maskInputs: true, // Mask passwords and emails

  // Custom rrweb options
  rrwebOptions: {
    sampling: {
      scroll: 150, // Sample scroll every 150ms
      input: 'last', // Only capture final input value
    },
  },
});

recorder.start();
```

## Session Format

The recorder produces a `GremlinSession` object with this structure:

```typescript
interface GremlinSession {
  // Session metadata
  header: {
    sessionId: string;
    startTime: number;
    endTime?: number;
    device: DeviceInfo;
    app: AppInfo;
    schemaVersion: number;
  };

  // Element dictionary (deduplicated)
  elements: ElementInfo[];

  // Recorded events (delta-encoded timestamps)
  events: GremlinEvent[];

  // Screenshots (if captured)
  screenshots: Screenshot[];
}
```

### Element Identification Priority

Elements are identified in this priority order:

1. **Test ID** (`data-testid`, `data-test-id`) - Best for test generation
2. **Accessibility Label** (`aria-label`, `aria-labelledby`)
3. **Text Content** - Visible text (truncated to 100 chars)
4. **CSS Selector** - Generated selector path as fallback

Example element in dictionary:

```json
{
  "testId": "submit-button",
  "accessibilityLabel": "Submit form",
  "text": "Submit",
  "type": "button",
  "bounds": { "x": 100, "y": 200, "width": 80, "height": 40 },
  "cssSelector": "form > button.primary",
  "attributes": { "type": "submit" }
}
```

## Event Types

The recorder captures these event types:

- **TAP**: Click events with element identification
- **INPUT**: Text input, select changes (with optional masking)
- **SCROLL**: Scroll position changes
- **NAVIGATION**: URL changes, pushState, popState
- **ERROR**: JavaScript errors and unhandled promise rejections
- **NETWORK**: HTTP requests (requires instrumentation)
- **SCREEN_CAPTURE**: Screenshots (requires separate capture)

## API Reference

### `GremlinRecorder`

#### Constructor

```typescript
new GremlinRecorder(config: RecorderConfig)
```

#### Methods

- `start(): void` - Start recording
- `stop(): GremlinSession | null` - Stop recording and return session
- `getSession(): GremlinSession | null` - Get current session without stopping
- `isActive(): boolean` - Check if currently recording
- `exportJson(): string | null` - Export session as JSON string

### `RecorderConfig`

```typescript
interface RecorderConfig {
  appName: string; // Required: Your app name
  appVersion: string; // Required: Your app version
  appBuild?: string; // Optional: Build number
  autoStart?: boolean; // Auto-start on page load (default: false)
  capturePerformance?: boolean; // Sample performance metrics (default: true)
  performanceInterval?: number; // Performance sample interval ms (default: 5000)
  maskInputs?: boolean; // Mask sensitive inputs (default: true)
  onEvent?: (event: GremlinEvent) => void; // Real-time event callback
  rrwebOptions?: Partial<recordOptions>; // Custom rrweb options
}
```

## Element Capture Utilities

The package also exports utility functions for element capture:

```typescript
import { captureElement, findInteractiveElement } from '@gremlin/recorder-web';

// Capture element info
const element = document.querySelector('#my-button');
const elementInfo = captureElement(element);

// Find closest interactive element
const target = event.target;
const interactive = findInteractiveElement(target);
```

## Best Practices

### 1. Add Test IDs to Your Components

```html
<!-- Good: Has test ID -->
<button data-testid="submit-button">Submit</button>

<!-- Better: Has both test ID and aria-label -->
<button data-testid="submit-button" aria-label="Submit form">Submit</button>
```

### 2. Use Semantic HTML

```html
<!-- Good: Semantic button -->
<button>Click me</button>

<!-- Avoid: Non-semantic div (harder to identify) -->
<div onclick="...">Click me</div>
```

### 3. Mask Sensitive Data

```typescript
const recorder = new GremlinRecorder({
  appName: 'MyApp',
  appVersion: '1.0.0',
  maskInputs: true, // Masks passwords and emails
});
```

### 4. Handle Session Lifecycle

```typescript
// Start recording when user logs in
function onLogin() {
  recorder.start();
}

// Stop and send session when user logs out
function onLogout() {
  const session = recorder.stop();
  if (session) {
    sendSessionToBackend(session);
  }
}
```

## Integration with Gremlin

This recorder is part of the Gremlin project. Sessions can be:

1. **Sent to Gremlin Server** for storage and analysis
2. **Processed by AI** to extract user flows and generate tests
3. **Replayed** using rrweb for debugging
4. **Converted to Tests** using Playwright, Cypress, or other frameworks

## Performance

The recorder is optimized for production use:

- **Minimal overhead**: Events are captured asynchronously
- **Delta encoding**: Timestamps are delta-encoded to reduce size
- **Element deduplication**: Elements are stored once in a dictionary
- **Sampling**: Configurable sampling for scrolls and mouse moves
- **Selective capture**: Only captures user interactions, not every DOM change

## Browser Support

Supports all modern browsers that rrweb supports:

- Chrome/Edge 49+
- Firefox 36+
- Safari 10+
- iOS Safari 10+

## License

MIT
