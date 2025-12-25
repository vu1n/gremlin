# Gremlin

> AI-powered test generation from real user sessions

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black.svg)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Gremlin automatically generates comprehensive test suites by recording real user sessions and using AI to extract application behavior patterns. It supports both web applications (Playwright) and React Native apps (Maestro).

## Overview

Traditional testing requires developers to manually write tests based on specs or guesswork. Gremlin flips this model:

1. **Record** - Capture real user sessions from web or mobile apps
2. **Analyze** - AI extracts state machines, flows, and properties from sessions
3. **Generate** - Automatically create Playwright or Maestro tests
4. **Fuzz** - Generate chaos tests to find edge cases and bugs

Gremlin doesn't just replay sessions - it understands your application's behavior and generates maintainable, comprehensive test suites.

## Features

- **Multi-Platform Recording**
  - Web apps via `@gremlin/recorder-web` (rrweb integration)
  - React Native apps via `@gremlin/recorder-react-native` (coming soon)
  - Captures interactions, navigation, errors, and performance metrics
  - Import existing rrweb recordings from PostHog, LogRocket, etc.

- **AI-Powered Analysis**
  - Extracts state machines from user sessions
  - Identifies common flows and edge cases
  - Generates property-based test assertions
  - Supports Anthropic Claude, OpenAI GPT, and Google Gemini

- **Test Generation**
  - **Playwright tests** for web applications with full TypeScript support
  - **Maestro flows** for React Native apps (iOS/Android)
  - Grouped by user flows with descriptive comments
  - Includes performance and error validation

- **Fuzz Testing**
  - Random walk exploration
  - Boundary value abuse
  - Sequence mutation
  - Back button chaos
  - Rapid-fire interactions
  - Invalid state access attempts

- **Performance Capture**
  - Memory usage tracking
  - Navigation timing
  - Error correlation
  - Session replay support

## Quick Start

### Installation

```bash
# Install CLI globally
bun add -g @gremlin/cli

# Or use in project
bun add -D @gremlin/cli
```

### 1. Setup Recording (Web)

Install the web recorder in your application:

```bash
bun add @gremlin/recorder-web
```

Add to your app:

```typescript
import { GremlinRecorder } from '@gremlin/recorder-web';

// Initialize recorder
const recorder = new GremlinRecorder({
  appName: 'my-app',
  appVersion: '1.0.0',
  autoStart: true,              // Start recording immediately
  capturePerformance: true,      // Capture memory/timing metrics
  maskInputs: true,              // Mask passwords/emails
  persistSession: true,          // Continue recording across page loads
  enableBatching: true,          // Optimize scroll event batching
  scrollBatchWindow: 150,        // Coalesce scrolls within 150ms
});

// Export session when done
const session = recorder.stop();
if (session) {
  // Send to backend or download
  fetch('/api/gremlin/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

// For multi-page apps, resume on page load
if (recorder.hasPersistentSession()) {
  recorder.resume();
}
```

### 2. Setup Recording (React Native)

```bash
bun add @gremlin/recorder-react-native
```

Add to your app:

```typescript
import { GremlinRecorder, LocalTransport } from '@gremlin/recorder-react-native';

// Initialize recorder with auto-upload
const recorder = new GremlinRecorder({
  appName: 'my-app',
  appVersion: '1.0.0',
  capturePerformance: true,
  transport: new LocalTransport({
    endpoint: 'http://localhost:3334/sessions', // gremlin dev server
  }),
});

// Start recording
recorder.start();

// The recorder automatically captures:
// - Touch gestures (tap, swipe, long press)
// - Text inputs
// - Scroll events
// - Navigation (React Navigation)
// - Performance metrics (FPS, memory)
// - Errors

// Stop and upload session
const session = recorder.stop();
```

### 3. Generate Tests

```bash
# Initialize Gremlin in your project
gremlin init

# Place session JSON files in .gremlin/sessions/
# Then generate tests
gremlin generate

# Or with specific options
gremlin generate \
  --input .gremlin/sessions \
  --output .gremlin/tests \
  --playwright \
  --base-url http://localhost:3000 \
  --provider anthropic
```

**What this does:**
- Analyzes all sessions using AI to extract application behavior
- Creates a state machine model (`spec.json`)
- Generates executable Playwright tests in `.gremlin/tests/playwright/`

**Environment Variables:**
Set one of these API keys for AI analysis:
- `ANTHROPIC_API_KEY` - For Claude (recommended)
- `OPENAI_API_KEY` - For GPT models
- `GEMINI_API_KEY` - For Google Gemini

### 4. Generate Fuzz Tests

```bash
# Generate chaos tests to find bugs
gremlin fuzz \
  --spec .gremlin/tests/spec.json \
  --strategy all \
  --count 20

# Or target specific strategies
gremlin fuzz \
  --strategy random-walk,boundary \
  --count 10 \
  --seed 12345
```

### 5. Run Tests

```bash
# Run all generated tests via Gremlin CLI
gremlin run

# Or run specific frameworks directly
npx playwright test .gremlin/tests/playwright
maestro test .gremlin/tests/maestro

# Run with options
gremlin run --headed              # Playwright in headed mode
gremlin run --watch               # Playwright UI mode
gremlin run --device "iPhone 15"  # Maestro on specific device
```

## Package Overview

Gremlin is organized as a monorepo with the following packages:

### [@gremlin/cli](./packages/cli)
Command-line interface for test generation and fuzzing. The main entry point for developers.

**Commands:**
- `gremlin init` - Initialize project structure
- `gremlin dev` - Start dev server to receive sessions from SDK
- `gremlin import` - Import sessions from PostHog API or rrweb files
- `gremlin generate` - Generate tests from sessions using AI
- `gremlin fuzz` - Generate fuzz tests from state model
- `gremlin run` - Run generated Playwright/Maestro tests
- `gremlin replay` - Replay recorded sessions
- `gremlin instrument` - Generate instrumentation prompts for your app

### [@gremlin/session](./packages/session)
Lightweight client-side types and transport. Used by recorders - safe for browser bundling.

**Exports:**
- `GremlinSession` - Session recording format
- `GremlinEvent` - Event types (tap, scroll, input, etc.)
- `ElementInfo` - Element identification data
- `EventBatcher` - Event batching utilities
- `LocalTransport` - Session upload transport

### [@gremlin/analysis](./packages/analysis)
Server-side AI analysis and test generators. Heavy dependencies - NOT for client bundling.

**Exports:**
- `GremlinSpec` - State machine model types
- `analyzeFlows()` - AI-powered flow analysis
- `generatePlaywrightTests()` - Playwright test generator
- `generateMaestroFlows()` - Maestro test generator
- Importers for rrweb, PostHog, and custom formats

### [@gremlin/recorder-web](./packages/recorder-web)
Web session recorder built on rrweb. Captures DOM interactions with smart element identification.

**Features:**
- Click, input, scroll, navigation tracking
- Performance metrics (memory, navigation timing)
- Error event recording (JS errors, unhandled rejections)
- Smart element identification (test IDs, ARIA labels, CSS selectors)
- Session persistence for multi-page apps
- Event batching for scroll optimization
- Real-time event streaming via callbacks

**Element Identification:**
The recorder captures multiple identifiers for each element:
- `testId` - data-testid attributes
- `ariaLabel` - ARIA labels and descriptions
- `text` - Element text content
- `xpath` - Simplified XPath
- `css` - CSS selector

This ensures generated tests are resilient to UI changes.

### [@gremlin/recorder-react-native](./packages/recorder-react-native)
React Native session recorder for iOS and Android applications.

**Features:**
- Touch gesture tracking (tap, swipe, long press, double-tap)
- Input and scroll events
- Navigation state capture (React Navigation integration)
- View hierarchy recording with testID extraction
- Performance monitoring (FPS, memory, JS thread)
- Error reporting (native + JS exceptions)
- LocalTransport for auto-upload to dev server

### [@gremlin/proto](./packages/proto)
Protocol buffer definitions for efficient session serialization (future enhancement for binary format support).

## CLI Commands Reference

### `gremlin init`
Initialize Gremlin in the current project. Creates `.gremlin/` directory structure.

```bash
gremlin init
```

This creates:
```
.gremlin/
├── sessions/    # Place recorded sessions here
├── tests/       # Generated tests output here
└── config.json  # Configuration (optional)
```

### `gremlin generate`
Generate tests from recorded sessions using AI analysis.

```bash
gremlin generate [options]
```

**Options:**
- `-i, --input <path>` - Input sessions directory (default: `.gremlin/sessions`)
- `-o, --output <path>` - Output tests directory (default: `.gremlin/tests`)
- `--spec <path>` - Use existing GremlinSpec file instead of analyzing sessions
- `--playwright` - Generate Playwright tests (default: `true`)
- `--maestro` - Generate Maestro tests for mobile
- `--base-url <url>` - Base URL for web tests (default: `http://localhost:3000`)
- `--app-id <id>` - App ID for mobile tests (default: `com.example.app`)
- `--provider <name>` - AI provider: `anthropic`, `openai`, or `gemini`

**Example:**
```bash
gremlin generate \
  --input ./user-sessions \
  --output ./e2e-tests \
  --playwright \
  --base-url https://staging.example.com \
  --provider anthropic
```

**Output:**
- `.gremlin/tests/spec.json` - Extracted state machine model
- `.gremlin/tests/playwright/generated.spec.ts` - Playwright tests
- `.gremlin/tests/maestro/*.yaml` - Maestro flows (if `--maestro`)

### `gremlin fuzz`
Generate fuzz tests from state model to find edge cases and bugs.

```bash
gremlin fuzz [options]
```

**Options:**
- `--spec <path>` - Path to GremlinSpec file (default: `.gremlin/tests/spec.json`)
- `-o, --output <path>` - Output directory (default: `.gremlin/tests/fuzz`)
- `--strategy <type>` - Comma-separated strategies or `all` (default: `all`)
- `--count <number>` - Number of tests to generate (default: `10`)
- `--seed <number>` - Random seed for reproducible tests

**Fuzz Strategies:**
- `random-walk` - Random exploration of state transitions
- `boundary` - Test boundary values and limits
- `chaos` - Chaotic interaction patterns
- `all` - All strategies combined

**Example:**
```bash
gremlin fuzz \
  --spec .gremlin/tests/spec.json \
  --strategy random-walk,boundary \
  --count 25 \
  --seed 42
```

### `gremlin import`
Import sessions from PostHog or local files.

```bash
gremlin import [options]
```

**Options:**
- `--posthog` - Import from PostHog session recordings
- `--file <path>` - Import from local rrweb JSON file
- `--api-key <key>` - PostHog API key (or set `POSTHOG_API_KEY`)
- `--project-id <id>` - PostHog project ID (or set `POSTHOG_PROJECT_ID`)
- `--host <url>` - PostHog host (default: `https://app.posthog.com`)
- `--recording-id <id>` - Import a specific recording
- `--limit <number>` - Max recordings to import (default: `10`)
- `--date-from <date>` - Filter: recordings after this date (ISO)
- `--date-to <date>` - Filter: recordings before this date (ISO)
- `-o, --output <path>` - Output directory (default: `.gremlin/sessions`)

**Examples:**
```bash
# Import from PostHog (uses env vars)
export POSTHOG_API_KEY="phx_..."
export POSTHOG_PROJECT_ID="12345"
gremlin import --posthog --limit 20

# Import specific recording
gremlin import --posthog --recording-id abc123

# Import from local file
gremlin import --file ./recording.json
```

### `gremlin run`
Run generated Playwright and/or Maestro tests.

```bash
gremlin run [test] [options]
```

**Arguments:**
- `test` - Specific test file or pattern to run

**Options:**
- `--all` - Run all tests
- `-d, --tests-dir <path>` - Tests directory (default: `.gremlin/tests`)
- `--headed` - Run Playwright in headed mode
- `--watch` - Run Playwright in UI/watch mode
- `--update-snapshots` - Update Playwright snapshots
- `--device <name>` - Maestro device to run on

**Examples:**
```bash
# Run all tests
gremlin run

# Run specific test
gremlin run login.spec.ts

# Run Playwright in headed mode
gremlin run --headed

# Run on specific Maestro device
gremlin run --device "iPhone 15 Pro"
```

## Configuration

Create a `.gremlin/config.json` file to configure default behavior:

```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022"
  },
  "recorder": {
    "maskInputs": true,
    "capturePerformance": true,
    "performanceInterval": 5000,
    "enableBatching": true,
    "scrollBatchWindow": 150
  },
  "playwright": {
    "baseUrl": "http://localhost:3000",
    "timeout": 30000,
    "includeComments": true,
    "includeVisualTests": false,
    "groupBy": "flow"
  },
  "maestro": {
    "appId": "com.example.app",
    "platform": "ios",
    "includeScreenshots": true,
    "includeComments": true
  },
  "fuzz": {
    "defaultStrategies": ["random-walk", "boundary"],
    "defaultCount": 20
  }
}
```

## Advanced Usage

### Custom Test Generation

Use the analysis library directly for custom test generation workflows:

```typescript
import {
  analyzeFlows,
  generatePlaywrightTests,
} from '@gremlin/analysis';
import type { GremlinSession } from '@gremlin/session';

// Load your sessions
const sessions: GremlinSession[] = await loadSessionsFromDatabase();

// Analyze with AI
const spec = await analyzeFlows(sessions, {
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  appName: 'my-app',
  platform: 'web',
});

// Generate custom tests
const testCode = generatePlaywrightTests(spec, {
  baseUrl: 'https://staging.example.com',
  includeComments: true,
  includeVisualTests: true,
  timeout: 60000,
  groupBy: 'state', // or 'flow'
});

// Write to file or process further
await Bun.write('./tests/generated.spec.ts', testCode);
```

### Session Optimization

The EventBatcher in `@gremlin/session` optimizes events during recording:

```typescript
import { EventBatcher } from '@gremlin/session';

const batcher = new EventBatcher({
  scrollBatchWindow: 150,  // Coalesce scrolls within 150ms
});

// Events are automatically batched during recording
batcher.add(scrollEvent);
const batched = batcher.flush();
```

### Real-time Session Streaming

Stream session events to a backend as they happen:

```typescript
import { GremlinRecorder } from '@gremlin/recorder-web';

const recorder = new GremlinRecorder({
  appName: 'my-app',
  appVersion: '1.0.0',
  onEvent: (event) => {
    // Send each event to backend in real-time
    fetch('/api/gremlin/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },
});
```

### Element Capture Customization

Understand how elements are captured:

```typescript
// The recorder automatically captures:
// 1. test IDs (data-testid, data-test)
// 2. ARIA labels (aria-label, aria-labelledby)
// 3. Text content (for buttons, links)
// 4. Simplified XPath
// 5. CSS selector

// Example captured element:
{
  testId: "submit-button",
  ariaLabel: "Submit form",
  text: "Submit",
  xpath: "//button[@data-testid='submit-button']",
  css: "button.submit-btn"
}
```

### Batch Operations

Process multiple sessions efficiently:

```typescript
import { analyzeFlows, generatePlaywrightTests } from '@gremlin/analysis';
import { readdirSync } from 'fs';
import { join } from 'path';

async function batchGenerate(sessionsDir: string, outputDir: string) {
  // Load all sessions
  const files = readdirSync(sessionsDir);
  const sessions = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      const content = await Bun.file(join(sessionsDir, file)).text();
      sessions.push(JSON.parse(content));
    }
  }

  console.log(`Loaded ${sessions.length} sessions`);

  // Analyze with AI
  const spec = await analyzeFlows(sessions, {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    appName: 'my-app',
    platform: 'web',
  });

  // Generate tests
  const tests = generatePlaywrightTests(spec, {
    baseUrl: 'http://localhost:3000',
    includeComments: true,
  });

  await Bun.write(join(outputDir, 'generated.spec.ts'), tests);
}
```

## How It Works

### 1. Recording Phase

The recorder captures user interactions at a high level:

**Web (via rrweb):**
- Click events (with target element)
- Input events (with masking for sensitive data)
- Scroll events (batched for efficiency)
- Navigation events (pushState, popstate, page loads)
- Error events (JS errors, unhandled rejections)
- Performance metrics (memory, timing)

**React Native (coming soon):**
- Touch gestures (tap, swipe, long press)
- Input and scroll events
- Navigation state changes
- View hierarchy snapshots

Each event includes:
- **Element identification** - Multiple identifiers (test ID, ARIA, text, XPath, CSS)
- **Timestamp** - Absolute time and relative delta (dt)
- **Performance metrics** - Memory usage, navigation timing (optional)
- **Screen context** - Current route, screen name, URL

### 2. Analysis Phase

AI analyzes the sessions to extract application behavior:

**States** - Unique screens or views
```typescript
{
  id: "login_screen",
  name: "Login Screen",
  description: "User authentication page",
  elements: ["email_input", "password_input", "submit_button"]
}
```

**Transitions** - How users move between states
```typescript
{
  from: "login_screen",
  to: "dashboard",
  action: { type: "tap", element: "submit_button" },
  precondition: "email and password filled"
}
```

**Variables** - Data that flows through the application
```typescript
{
  name: "user_email",
  type: "string",
  scope: "global"
}
```

**Properties** - Invariants and assertions to test
```typescript
{
  name: "Logged in users can access dashboard",
  type: "safety",
  expression: "auth_token != null => can_access(dashboard)"
}
```

This creates a **GremlinSpec** - a formal state machine model of your application.

### 3. Generation Phase

Test generators convert the spec into executable tests:

**Playwright** (TypeScript):
```typescript
test.describe('Login Flow', () => {
  test('should login successfully', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('email_input').fill('user@example.com');
    await page.getByTestId('password_input').fill('password');
    await page.getByTestId('submit_button').click();
    await expect(page).toHaveURL('/dashboard');
  });
});
```

**Maestro** (YAML):
```yaml
appId: com.example.app
---
- launchApp
- tapOn:
    id: "email_input"
- inputText: "user@example.com"
- tapOn:
    id: "password_input"
- inputText: "password"
- tapOn:
    id: "submit_button"
- assertVisible:
    id: "dashboard_header"
```

Tests are organized by user flows and include:
- Setup and teardown hooks
- Assertions based on extracted properties
- Error handling and recovery
- Performance checks (optional)

### 4. Fuzz Phase (Optional)

Fuzz test generators create chaos scenarios to find edge cases:

**Random Walk** - Explore the state space randomly
```typescript
// Random sequence: login → profile → settings → logout → login → ...
```

**Boundary Abuse** - Test edge values
```typescript
// Input very long strings, negative numbers, special characters
```

**Rapid Fire** - Fast repeated actions
```typescript
// Click submit button 100 times in 1 second
```

**Invalid State Access** - Try impossible transitions
```typescript
// Try to access dashboard without logging in
```

These tests find bugs that real users might never encounter but could exist in your code.

## Examples

See the [examples](./examples) directory for full applications:

- **[web-app](./examples/web-app)** - React web application with Gremlin recorder integration
- **[expo-app](./examples/expo-app)** - React Native Expo app (coming soon)

## API Reference

### GremlinRecorder (Web)

```typescript
class GremlinRecorder {
  constructor(config: RecorderConfig)
  start(): void
  stop(): GremlinSession | null
  getSession(): GremlinSession | null
  isActive(): boolean
  exportJson(): string | null
  resume(): boolean
  hasPersistentSession(): boolean
  clearStorage(): void
}

interface RecorderConfig {
  appName: string
  appVersion: string
  appBuild?: string
  autoStart?: boolean
  capturePerformance?: boolean
  performanceInterval?: number
  maskInputs?: boolean
  onEvent?: (event: GremlinEvent) => void
  rrwebOptions?: Partial<recordOptions<eventWithTime>>
  persistSession?: boolean
  storageKey?: string
  enableBatching?: boolean
  scrollBatchWindow?: number
}
```

### Core Functions

```typescript
// AI Analysis
function analyzeFlows(
  sessions: GremlinSession[],
  options: AnalyzeOptions
): Promise<GremlinSpec>

// Test Generation
function generatePlaywrightTests(
  spec: GremlinSpec,
  options: PlaywrightOptions
): string

function generateMaestroFlows(
  spec: GremlinSpec,
  options: MaestroOptions
): MaestroFlow[]

// Session Optimization
function optimizeSession(
  session: GremlinSession,
  options: OptimizeOptions
): GremlinSession
```

## Troubleshooting

### No API key found error

Make sure you've set one of these environment variables:
```bash
export ANTHROPIC_API_KEY="your-key-here"
# or
export OPENAI_API_KEY="your-key-here"
# or
export GEMINI_API_KEY="your-key-here"
```

### Sessions directory not found

Ensure your sessions are in the correct location:
```bash
ls .gremlin/sessions/
# Should show .json files
```

### Generated tests fail to run

Make sure Playwright is installed:
```bash
bun add -D @playwright/test
npx playwright install
```

### Performance issues with recording

Enable batching to reduce event volume:
```typescript
const recorder = new GremlinRecorder({
  // ...
  enableBatching: true,
  scrollBatchWindow: 150,  // Coalesce scrolls within 150ms
});
```

### TypeScript errors in generated tests

Make sure your `tsconfig.json` includes the output directory:
```json
{
  "include": [".gremlin/tests/**/*"]
}
```

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/gremlin.git
cd gremlin

# Install dependencies (using Bun)
bun install

# Build all packages
bun run build

# Run tests
bun run test

# Lint code
bun run lint

# Clean build artifacts
bun run clean
```

### Project Structure

```
gremlin/
├── packages/
│   ├── cli/                    # Command-line interface
│   ├── session/                # Client-side types and transport
│   ├── analysis/               # AI analysis and test generators
│   ├── ast/                    # Code-based state discovery
│   ├── recorder-web/           # Web recorder (rrweb)
│   ├── recorder-react-native/  # React Native recorder
│   ├── proto/                  # Protocol buffers
│   └── server/                 # Session storage server (Cloudflare Worker)
├── examples/
│   └── web-app/               # Example web app
├── package.json               # Root workspace config
└── tsconfig.json              # TypeScript config
```

### Building Individual Packages

```bash
# Build a specific package
cd packages/cli
bun run build

# Or use workspace filter
bun run --filter '@gremlin/cli' build
```

## Roadmap

**v0.1.0 - MVP** (Current)
- [x] Web recorder with rrweb integration
- [x] React Native recorder (gesture capture, performance, navigation)
- [x] AI-powered flow analysis (Claude, GPT, Gemini)
- [x] Playwright test generation
- [x] Maestro test generation
- [x] Fuzz test generation
- [x] CLI interface
- [x] PostHog import integration
- [x] Session replay viewer
- [x] Unified test runner (`gremlin run`)

**v0.2.0 - Enhanced Recording**
- [ ] Chrome extension for zero-config recording
- [ ] Real-time session streaming improvements
- [ ] Session diff and merge tools

**v0.3.0 - Advanced Testing**
- [ ] Visual regression testing
- [ ] Property-based test generation
- [ ] TLA+ formal verification
- [ ] Test maintenance automation

**v1.0.0 - Production Ready**
- [ ] CI/CD integrations
- [ ] Performance optimizations
- [ ] Enterprise features
- [ ] Cloud hosting option

## Contributing

Contributions are welcome! Please check out our [Contributing Guide](./CONTRIBUTING.md) for details on:

- Code of conduct
- Development workflow
- Testing requirements
- Pull request process
- Code style guidelines

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Commit changes (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Acknowledgments

- Built with [rrweb](https://github.com/rrweb-io/rrweb) for web session recording
- Powered by [Anthropic Claude](https://www.anthropic.com/), [OpenAI GPT](https://openai.com/), and [Google Gemini](https://deepmind.google/technologies/gemini/)
- Inspired by property-based testing, model-based testing, and formal verification research
- Test generation inspired by [Playwright](https://playwright.dev/) and [Maestro](https://maestro.mobile.dev/)

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/gremlin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/gremlin/discussions)
- **Twitter**: [@gremlin_ai](https://twitter.com/gremlin_ai)

---

**Made with precision by the Gremlin team** 🐸
