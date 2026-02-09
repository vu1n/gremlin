# Gremlin

> AI-powered test generation from real user sessions

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black.svg)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Gremlin automatically generates comprehensive test suites by recording real user sessions and using AI to extract application behavior patterns. It supports both web applications (Playwright) and React Native apps (Maestro).

## How It Works

1. **Record** - Capture real user sessions from web or mobile apps
2. **Analyze** - AI extracts state machines, flows, and properties from sessions
3. **Generate** - Automatically create Playwright or Maestro tests
4. **Fuzz** - Generate chaos tests to find edge cases and bugs

Gremlin doesn't just replay sessions — it understands your application's behavior and generates maintainable, comprehensive test suites.

## Quick Start

### With an AI Agent (Recommended)

The fastest way to use Gremlin. Add the MCP server to your AI editor, then let the agent handle setup, recording, and test generation.

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gremlin": {
      "command": "bun",
      "args": ["run", "/path/to/gremlin/packages/mcp/src/index.ts"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-xxx"
      }
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gremlin": {
      "command": "bun",
      "args": ["run", "/path/to/gremlin/packages/mcp/src/index.ts"]
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add gremlin -- bun run /path/to/gremlin/packages/mcp/src/index.ts
```

Then ask your agent:

> "Set up Gremlin in this project, record a session, and generate tests."

The agent has access to 14 tools — it can initialize your project, check status, generate tests, run them, analyze performance, and more. See [MCP Deep Dive](#mcp-server) for the full tool list.

### With the CLI

```bash
# Install
bun add -g @gremlin/cli

# Initialize (auto-detects framework, installs SDK, instruments entry point)
gremlin init

# Verify setup
gremlin status

# Start recording sessions
gremlin dev          # Terminal 1 - session receiver
bun run dev          # Terminal 2 - your app
```

Use your app for a few minutes. Gremlin captures clicks, navigation, inputs, errors, and performance automatically.

```bash
# Generate tests from your sessions
gremlin generate

# Run the tests
gremlin run
```

**What just happened?**

1. `gremlin init` detected your framework (Next.js, Vite, Remix, etc.), installed the recorder SDK, and instrumented your app's entry point
2. `gremlin status` verified your config, session directory, and AI provider key
3. `gremlin dev` started a local server that receives sessions from your app
4. As you used your app, sessions were recorded to `.gremlin/sessions/`
5. `gremlin generate` analyzed those sessions with AI and generated executable tests
6. `gremlin run` executed the generated tests

### AI Provider Setup

Test generation and analysis require an API key from one of:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx   # Claude (recommended)
# or
export OPENAI_API_KEY=sk-xxx          # GPT-4o
# or
export GEMINI_API_KEY=xxx             # Gemini 2.0 Flash
```

Gremlin auto-detects which key is set. Verify with `gremlin status`.

---

## Features

- **Multi-Platform Recording** — Web apps via `@gremlin/recorder-web` (rrweb), React Native via `@gremlin/recorder-react-native`. Import existing rrweb recordings from PostHog, LogRocket, etc.

- **AI-Powered Analysis** — Extracts state machines, identifies common flows and edge cases, generates property-based assertions. Supports Claude, GPT, and Gemini.

- **Test Generation** — Playwright tests for web, Maestro flows for mobile. Grouped by user flows with descriptive comments, performance validation, and error checks.

- **Fuzz Testing** — Random walk exploration, boundary value abuse, sequence mutation, back button chaos, rapid-fire interactions, invalid state access.

- **Performance Instrumentation** — Web Vitals (LCP, CLS, INP, FCP, TTFB), FPS tracking, long task detection, memory monitoring. Per-event perf context. Regression testing with baselines and budgets.

- **AI Agent Integration** — MCP server with 14 tools, `--json` flag on every CLI command, `llms.txt` generation for agent context.

### Framework Support

Gremlin auto-detects and instruments:

- **Web**: Next.js, Vite, Create React App, Remix
- **Mobile**: Expo, React Native

---

## MCP Server

The `@gremlin/mcp` package gives AI agents direct access to Gremlin via the Model Context Protocol. Setup instructions are in [Quick Start](#with-an-ai-agent-recommended) above.

### Tools

| Tool | Description |
|------|-------------|
| `gremlin_status` | Project status: config, sessions, tests, AI provider |
| `gremlin_init` | Initialize Gremlin in the project |
| `gremlin_instrument_info` | Framework-specific instrumentation guidance |
| `gremlin_sessions_list` | List sessions with filters (app, platform, date) |
| `gremlin_session_get` | Get full session data by ID |
| `gremlin_generate_tests` | Generate Playwright/Maestro tests |
| `gremlin_run_tests` | Run generated tests |
| `gremlin_analyze` | AI insights: UX issues, errors, patterns, recommendations |
| `gremlin_analytics_summary` | Aggregate analytics across sessions |
| `gremlin_analytics_performance` | Web Vitals, FPS, memory with p50/p75/p95 percentiles |
| `gremlin_error_patterns` | Deduplicated error patterns with occurrence counts |
| `gremlin_perf_baseline` | Snapshot performance metrics as regression baseline |
| `gremlin_generate_perf_tests` | Generate performance regression tests |
| `gremlin_run_perf_tests` | Run perf tests and compare against baseline |

### Resources

| URI | Description |
|-----|-------------|
| `gremlin://config` | Project configuration |
| `gremlin://sessions/{id}` | Session data by ID |
| `gremlin://spec` | Generated state machine spec |
| `gremlin://llms.txt` | LLM instrumentation context |

### Example Agent Workflows

**New project setup:**
```
gremlin_init → gremlin_status → gremlin_instrument_info
```

**Generate tests:**
```
gremlin_status → gremlin_sessions_list → gremlin_generate_tests → gremlin_run_tests
```

**Performance audit:**
```
gremlin_analytics_performance → gremlin_analyze(focus: "performance") → gremlin_perf_baseline → gremlin_generate_perf_tests
```

**Error investigation:**
```
gremlin_error_patterns → gremlin_analyze(focus: "errors") → gremlin_generate_error_tests → gremlin_run_tests
```

See [`packages/mcp/README.md`](packages/mcp/README.md) for Windsurf setup and more details.

---

## CLI with `--json` (Agent-Friendly)

Every CLI command supports `--json` for structured, machine-readable output. This is how agents that don't support MCP can still use Gremlin programmatically.

```bash
gremlin init --json
gremlin status --json
gremlin sessions --json
gremlin generate --json
gremlin analyze --json
gremlin errors --json
```

Output envelope:

```json
{
  "ok": true,
  "command": "status",
  "data": { ... },
  "warnings": [],
  "meta": { "duration": 123 }
}
```

### `llms.txt` Context

Generate project-specific instrumentation context that any AI agent can consume:

```bash
gremlin instrument --llms
```

This outputs your framework, SDK package, entry point location, and setup instructions — everything an agent needs to instrument your app without reading your codebase.

---

## Generate Tests

```bash
gremlin generate
```

Analyzes sessions using AI and generates:
- Playwright tests for web apps
- Maestro flows for mobile apps
- A state machine model (`spec.json`) of your app

---

## Fuzz Tests

Find edge cases with chaos testing:

```bash
gremlin fuzz --strategy all --count 20
```

Strategies: `random-walk`, `boundary`, `chaos`, `all` (comma-separated).

---

## Performance Testing

Gremlin captures Web Vitals, FPS, long tasks, and memory on every session:

```bash
gremlin analytics performance         # View aggregated metrics
gremlin sessions --slow               # Find poor Core Web Vitals sessions
gremlin perf-baseline                 # Set performance baseline
gremlin generate --perf               # Generate regression tests
gremlin run --perf                    # Run perf tests against baseline
```

---

## Error Tracking

Find recurring error patterns and generate regression tests:

```bash
gremlin errors                        # List error patterns
gremlin errors --min-occurrences 3    # Filter by frequency
gremlin generate --errors             # Generate error regression tests
```

---

## AI-Powered Analysis

Get actionable insights without generating tests:

```bash
gremlin analyze                       # Full analysis
gremlin analyze --focus ux            # UX issues only
gremlin analyze --focus errors        # Error patterns
gremlin analyze --focus performance   # Performance insights
```

---

## Import Existing Sessions

Already using session recording? Import from PostHog or rrweb files:

```bash
gremlin import --posthog --api-key=phx_xxx --project-id=123 --limit=5
gremlin import --file ./recording.json
gremlin generate
```

---

## Manual SDK Setup

If auto-instrumentation didn't work or you need fine-grained control:

### Web Apps

```bash
bun add @gremlin/recorder-web
```

```typescript
import { GremlinRecorder } from '@gremlin/recorder-web';

const recorder = new GremlinRecorder({
  appName: 'my-app',
  appVersion: '1.0.0',
  autoStart: true,
  capturePerformance: true,      // Web Vitals, FPS, long tasks, memory
  maskInputs: true,
  persistSession: true,
});

recorder.start();
```

### React Native

```bash
bun add @gremlin/recorder-react-native
```

```typescript
import { GremlinRecorder } from '@gremlin/recorder-react-native';

const recorder = new GremlinRecorder({
  appName: 'my-app',
  appVersion: '1.0.0',
  capturePerformance: true,      // FPS, memory, JS thread lag
});

recorder.start();
```

---

## CI/CD Integration

```yaml
# .github/workflows/gremlin.yml
name: Gremlin Tests
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Install Gremlin CLI
        run: bun add -g @gremlin/cli

      - name: Check Gremlin status
        run: gremlin status --json

      - name: Generate tests from recorded sessions
        run: gremlin generate --json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run generated tests
        run: gremlin run --json

      - name: Run performance regression tests
        run: gremlin run --perf --json
```

Commit `.gremlin/sessions/` to the repo so CI can regenerate tests.

---

## Self-Hosted Session API

For teams that want full data ownership. Built on Bun + Hono, stores sessions as JSON files on disk.

```bash
# Docker
docker compose up --build

# Or generate an API key and run directly
bun run --filter '@gremlin/server-node' keygen
bun run --filter '@gremlin/server-node' dev
```

Server runs on `http://localhost:8787`. All sessions stored as plain JSON in `DATA_DIR/sessions`.

---

## Architecture

- **Recorder SDKs** (`@gremlin/recorder-web`, `@gremlin/recorder-react-native`)
- **CLI** (`@gremlin/cli`) — local ingest, test generation, analysis
- **MCP Server** (`@gremlin/mcp`) — AI agent integration
- **Self-hosted API** (`@gremlin/server-node`) — VPS/container deployments
- **Cloudflare Worker** (`@gremlin/server`) — serverless deployments

## Project Structure

```
gremlin/
├── packages/
│   ├── cli/                    # Command-line interface
│   ├── mcp/                    # MCP server for AI agents
│   ├── session/                # Session types and transport
│   ├── analysis/               # AI analysis and test generators
│   ├── ast/                    # Code-based state discovery
│   ├── recorder-web/           # Web recorder (rrweb + performance)
│   ├── recorder-react-native/  # React Native recorder
│   ├── proto/                  # Protocol buffers
│   ├── server/                 # Session server (Cloudflare Worker)
│   ├── server-node/            # Self-hosted session server (Bun)
│   └── server-shared/          # Shared server routes and types
├── examples/
│   ├── web-app/               # Example web app (Vite)
│   └── expo-app/              # Example Expo/React Native app
├── package.json               # Root workspace config
└── tsconfig.json              # TypeScript config
```

## CLI Reference

See [`packages/cli/README.md`](packages/cli/README.md) for the full command reference with all options.

## Development

```bash
git clone https://github.com/yourusername/gremlin.git
cd gremlin
bun install
bun test                                    # Run all tests
bun run --filter '@gremlin/cli' lint        # Type check a package
```

## Roadmap

**v0.1.0 - MVP** (Current)
- [x] Web recorder with rrweb + performance instrumentation
- [x] React Native recorder (gestures, performance, navigation)
- [x] AI-powered flow analysis (Claude, GPT, Gemini)
- [x] Playwright + Maestro test generation
- [x] Fuzz test generation
- [x] CLI with `--json` output
- [x] MCP server for AI agents
- [x] PostHog import
- [x] Session replay viewer
- [x] Performance + error regression testing

**v0.2.0** — Chrome extension, real-time streaming, session diff/merge

**v0.3.0** — Visual regression, property-based testing, test maintenance

**v1.0.0** — CI/CD integrations, cloud hosting, performance optimizations

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`bun test`)
4. Open a Pull Request

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgments

- [rrweb](https://github.com/rrweb-io/rrweb) for web session recording
- [Anthropic Claude](https://www.anthropic.com/), [OpenAI GPT](https://openai.com/), [Google Gemini](https://deepmind.google/technologies/gemini/)
- [Playwright](https://playwright.dev/) and [Maestro](https://maestro.mobile.dev/) for test execution
