# @gremlin/cli

Command-line interface for Gremlin. Record user sessions, generate tests, analyze behavior, and manage deployments.

## Installation

```bash
bun add -g @gremlin/cli
```

Or run directly from the monorepo:

```bash
bun run packages/cli/src/index.ts <command>
```

## Quick Start

```bash
gremlin init              # Auto-detect framework, install SDK, instrument app
gremlin status            # Verify setup is correct
gremlin dev               # Start local session receiver (Terminal 1)
# Start your app (Terminal 2), use it for a few minutes
gremlin sessions          # List recorded sessions
gremlin generate          # AI-generate Playwright/Maestro tests
gremlin run               # Run the generated tests
```

## AI Provider Setup

Test generation and analysis require an AI provider API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx   # Claude (recommended)
# or
export OPENAI_API_KEY=sk-xxx          # GPT-4o
# or
export GEMINI_API_KEY=xxx             # Gemini 2.0 Flash
```

Gremlin auto-detects which key is set. Priority: Anthropic > OpenAI > Gemini.

## `--json` Flag (Machine-Readable Output)

Every command supports `--json` for structured output. This is the primary interface for AI agents and CI/CD pipelines.

```bash
gremlin status --json
gremlin sessions --json
gremlin generate --json
gremlin analytics summary --json
```

Output envelope format:

```json
{
  "ok": true,
  "command": "status",
  "data": { ... },
  "warnings": [],
  "meta": { "duration": 123 }
}
```

On error:

```json
{
  "ok": false,
  "command": "generate",
  "errors": ["No sessions found. Run gremlin dev first."],
  "data": null
}
```

## Commands

### `gremlin init`

Initialize Gremlin in the current project. Auto-detects framework, installs the recorder SDK, and instruments your app's entry point.

```bash
gremlin init
gremlin init --framework vite --app-name "My App"
gremlin init --no-instrument    # Skip auto-instrumentation
gremlin init --skip-install     # Skip SDK package installation
gremlin init --server-url https://gremlin.example.com
```

| Option | Description |
|--------|-------------|
| `--app-name <name>` | App name for recorder config |
| `--framework <name>` | Force framework: `nextjs`, `vite`, `cra`, `remix`, `expo`, `react-native` |
| `--skip-install` | Skip SDK package installation |
| `--no-instrument` | Skip auto-instrumentation of entry point |
| `--server-url <url>` | Configure remote server URL |

### `gremlin status`

Show project status: config, session count, test counts, AI provider availability.

```bash
gremlin status
gremlin status --json    # Machine-readable for agents
```

### `gremlin dev`

Start a local server to receive sessions from the recorder SDK. Sessions are saved to `.gremlin/sessions/` as JSON files.

```bash
gremlin dev
gremlin dev --port 4000
gremlin dev --output ./my-sessions --verbose
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <number>` | `3334` | Port for dev server |
| `-o, --output <path>` | `.gremlin/sessions` | Output directory for sessions |
| `-v, --verbose` | `false` | Verbose logging |

The dev server exposes `/health` and `/metrics` endpoints for monitoring.

### `gremlin sessions`

List recorded sessions with optional performance filtering.

```bash
gremlin sessions
gremlin sessions --limit 5
gremlin sessions --sort lcp --lcp-gt 2500    # Slow LCP sessions
gremlin sessions --slow                       # Failing Core Web Vitals
gremlin sessions --json
```

| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Sessions directory (default `.gremlin/sessions`) |
| `-l, --limit <number>` | Max sessions to list (default `20`) |
| `--sort <metric>` | Sort by: `lcp`, `cls`, `inp`, `fcp`, `ttfb`, `fps`, `longTasks`, `memory`, `duration` |
| `--lcp-gt <ms>` | Filter: LCP exceeds threshold |
| `--cls-gt <value>` | Filter: CLS exceeds threshold |
| `--fps-lt <number>` | Filter: avgFps below threshold |
| `--slow` | Sessions failing Core Web Vitals (LCP>2500 OR CLS>0.25 OR INP>200) |

### `gremlin generate`

Generate tests from recorded sessions using AI.

```bash
gremlin generate
gremlin generate --provider anthropic --playwright
gremlin generate --maestro --app-id com.example.app
gremlin generate --perf          # Performance regression tests from baseline
gremlin generate --errors        # Error regression tests from session patterns
gremlin generate --json
```

| Option | Default | Description |
|--------|---------|-------------|
| `-i, --input <path>` | `.gremlin/sessions` | Input sessions directory |
| `-o, --output <path>` | `.gremlin/tests` | Output tests directory |
| `--spec <path>` | — | Use existing GremlinSpec instead of analyzing |
| `--playwright` | `true` | Generate Playwright tests |
| `--maestro` | — | Generate Maestro tests |
| `--base-url <url>` | `http://localhost:3000` | Base URL for web tests |
| `--app-id <id>` | `com.example.app` | App ID for mobile tests |
| `--provider <name>` | auto-detect | AI provider: `anthropic`, `openai`, `gemini` |
| `--perf` | — | Generate performance regression tests |
| `--errors` | — | Generate error regression tests |
| `--min-occurrences <n>` | `1` | Min error occurrences for `--errors` |

### `gremlin fuzz`

Generate chaos/fuzz tests from the state machine model.

```bash
gremlin fuzz
gremlin fuzz --strategy random-walk --count 20
gremlin fuzz --strategy boundary,chaos --seed 42
```

| Option | Default | Description |
|--------|---------|-------------|
| `--spec <path>` | `.gremlin/tests/spec.json` | Path to GremlinSpec file |
| `-o, --output <path>` | `.gremlin/tests/fuzz` | Output directory |
| `--strategy <type>` | `all` | `random-walk`, `boundary`, `chaos`, `all` (comma-separated) |
| `--count <number>` | `10` | Number of tests to generate |
| `--seed <number>` | random | Random seed for reproducible tests |

### `gremlin run`

Run generated tests (Playwright and/or Maestro).

```bash
gremlin run
gremlin run --all
gremlin run specific-test.spec.ts
gremlin run --headed --verbose
gremlin run --perf    # Performance regression tests vs baseline
```

| Option | Description |
|--------|-------------|
| `[test]` | Specific test file or pattern |
| `--all` | Run all tests |
| `-d, --tests-dir <path>` | Tests directory (default `.gremlin/tests`) |
| `-v, --verbose` | Verbose logging |
| `--headed` | Run Playwright in headed mode |
| `--watch` | Run Playwright in UI/watch mode |
| `--update-snapshots` | Update Playwright snapshots |
| `--device <name>` | Maestro device to run on |
| `--perf` | Run perf regression tests vs baseline |

### `gremlin analyze`

AI-powered insights from recorded sessions. Returns UX issues, error patterns, user behavior patterns, and recommendations.

```bash
gremlin analyze
gremlin analyze --focus errors
gremlin analyze --focus performance --provider anthropic
gremlin analyze --json
```

| Option | Default | Description |
|--------|---------|-------------|
| `-i, --input <path>` | `.gremlin/sessions` | Sessions directory |
| `--provider <name>` | auto-detect | AI provider |
| `--focus <type>` | `all` | Focus: `ux`, `errors`, `performance`, `all` |

### `gremlin instrument`

Generate instrumentation guidance for your framework. Use `--llms` to produce an `llms.txt` block that AI agents can consume for context.

```bash
gremlin instrument                    # Human-readable guidance
gremlin instrument --llms             # llms.txt for AI agents
gremlin instrument --framework expo
```

| Option | Description |
|--------|-------------|
| `--framework <name>` | Force framework |
| `--llms` | Output `llms.txt` format for AI agents |

### `gremlin import`

Import sessions from PostHog or local rrweb JSON files.

```bash
gremlin import --posthog --api-key=phx_xxx --project-id=123
gremlin import --posthog --recording-id=abc123 --limit=5
gremlin import --file ./recording.json
```

| Option | Description |
|--------|-------------|
| `--posthog` | Import from PostHog |
| `--file <path>` | Import from local rrweb JSON |
| `--format <type>` | File format: `rrweb`, `posthog` (auto-detected) |
| `--api-key <key>` | PostHog API key (or `POSTHOG_API_KEY` env) |
| `--project-id <id>` | PostHog project ID (or `POSTHOG_PROJECT_ID` env) |
| `--host <url>` | PostHog host (default `https://app.posthog.com`) |
| `--recording-id <id>` | Import specific recording |
| `--limit <number>` | Max recordings (default `10`) |
| `--date-from <date>` | Filter: after this ISO date |
| `--date-to <date>` | Filter: before this ISO date |
| `-o, --output <path>` | Output directory (default `.gremlin/sessions`) |

### `gremlin replay`

Replay a recorded session in the browser.

```bash
gremlin replay latest
gremlin replay .gremlin/sessions/abc123.json
gremlin replay session.json --speed 2 --no-autoplay
```

| Option | Default | Description |
|--------|---------|-------------|
| `<session>` | required | Path to session file or `latest` |
| `-p, --port <number>` | `3333` | Port for replay server |
| `--speed <number>` | `1` | Playback speed |
| `--no-autoplay` | — | Disable auto-play |

### `gremlin analytics`

Query aggregated analytics from sessions.

```bash
gremlin analytics summary
gremlin analytics summary --since 2025-01-01 --json
gremlin analytics errors --app "My App"
gremlin analytics performance --json
```

Subcommands: `summary`, `errors`, `performance`.

| Option | Description |
|--------|-------------|
| `--app <name>` | Filter by app name |
| `--since <date>` | Filter by ISO date |

### `gremlin errors`

List error patterns across sessions with occurrence counts and test coverage status.

```bash
gremlin errors
gremlin errors --min-occurrences 3
gremlin errors --generate    # Also generate error regression tests
gremlin errors --json
```

| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Sessions directory |
| `--min-occurrences <n>` | Minimum occurrences to show (default `1`) |
| `--since <date>` | Filter sessions after this ISO date |
| `--generate` | Generate error regression tests |

### `gremlin perf-baseline`

Snapshot current performance metrics as a baseline for regression testing.

```bash
gremlin perf-baseline
gremlin perf-baseline --margin 1.2 --update
```

| Option | Default | Description |
|--------|---------|-------------|
| `-i, --input <path>` | `.gremlin/sessions` | Sessions directory |
| `--margin <number>` | `1.4` | Budget margin multiplier above p75 |
| `--update` | — | Update existing baseline (keep tighter budgets) |

### `gremlin deploy`

Deploy and manage Gremlin servers.

```bash
gremlin deploy local                     # Start local server
gremlin deploy docker --port 8787        # Deploy with Docker
gremlin deploy status                    # Check deployment status
gremlin deploy stop                      # Stop all deployments
```

#### `deploy local`

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <number>` | `3334` | Port |
| `--background` | — | Run as background daemon |

#### `deploy docker`

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <number>` | `8787` | Port |
| `--api-key <key>` | auto-generate | API key |
| `--data-dir <path>` | — | Host data directory |
| `--no-detach` | — | Run in foreground |

#### `deploy status` / `deploy stop`

```bash
gremlin deploy status
gremlin deploy stop --target docker    # docker, local, or all
```

## Agent Workflow

For AI agents (Claude, GPT, Cursor, etc.), the recommended workflow uses `--json` throughout:

```bash
# 1. Initialize and verify
gremlin init --json
gremlin status --json

# 2. Get instrumentation context
gremlin instrument --llms

# 3. Record sessions (run dev server, then use the app)
gremlin dev

# 4. Review and generate
gremlin sessions --json
gremlin generate --json
gremlin analytics summary --json

# 5. Analyze with AI
gremlin analyze --json --focus all
```

For full MCP integration (Claude Desktop, Cursor, Windsurf), see [`@gremlin/mcp`](../mcp/README.md).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `POSTHOG_API_KEY` | PostHog API key (for import) |
| `POSTHOG_PROJECT_ID` | PostHog project ID (for import) |

## File Structure

```
.gremlin/
├── config.json              # Project config (created by init)
├── sessions/                # Recorded sessions (JSON)
├── tests/
│   ├── spec.json            # Generated state machine model
│   ├── playwright/          # Generated Playwright tests
│   ├── maestro/             # Generated Maestro flows
│   └── fuzz/                # Generated fuzz tests
├── analytics/               # Session analytics data
└── llms.txt                 # AI agent context (from instrument --llms)
```
