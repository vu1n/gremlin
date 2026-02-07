# Gremlin Agent Reference

## Quick Start (paste this into your AI agent)

```
Install Gremlin and set up session recording for this project:

1. Install: bun add -g @gremlin/cli
2. Initialize: gremlin init --app-name <app-name> --json
3. Deploy local server: gremlin deploy local --background --json
4. Instrument the app entry point with the SDK (see gremlin instrument --json)
5. Verify: gremlin status --json

After the user interacts with the app:
- View analytics: gremlin analytics summary --json
- Get AI insights: gremlin analyze --json
- Generate tests: gremlin generate --json
- Run tests: gremlin run --json
```

## Quick Reference

All commands support `--json` for machine-readable output.

| Command | Description | Key JSON fields |
|---------|-------------|-----------------|
| `gremlin init` | Initialize project | `{ initialized, framework, appName, sdkPackage, configPath }` |
| `gremlin status` | Project state check | `{ initialized, sdk, devServer, sessions, tests, analytics, ai }` |
| `gremlin dev` | Start dev server | NDJSON: `{ event: "server_started" \| "session_received", ... }` |
| `gremlin sessions` | List sessions | `{ sessions: [...], total, directory }` |
| `gremlin analyze` | AI-powered insights | `{ insights: {summary, uxIssues, errors, patterns, recommendations} }` |
| `gremlin generate` | Generate tests | `{ spec: {states,transitions,...}, tests: [{type,path,count}], provider }` |
| `gremlin fuzz` | Generate fuzz tests | `{ testCount, strategies, outputPath, seed }` |
| `gremlin run` | Run tests | `{ runners: [{name,dir,exitCode}], passed }` |
| `gremlin instrument` | Instrumentation guide | `{ framework, content, entryPoint, installCommand }` |
| `gremlin import` | Import sessions | `{ source, imported, failed, sessions[] }` |
| `gremlin analytics summary` | Aggregate stats | `{ totalSessions, totalEvents, totalErrors, avgDuration, platforms, topScreens }` |
| `gremlin analytics errors` | Error breakdown | `{ totalErrors, errorsByType, errors[] }` |
| `gremlin deploy local` | Start local server | `{ status, port, url, pid? }` |
| `gremlin deploy docker` | Deploy with Docker | `{ status, port, url, apiKey }` |
| `gremlin deploy status` | Check deployments | `{ local, docker, remote }` |
| `gremlin deploy stop` | Stop deployments | `{ local: {stopped}, docker: {stopped} }` |

## JSON Output Envelope

All `--json` output follows this structure:

```json
{
  "ok": true,
  "command": "status",
  "data": { ... },
  "errors": [],
  "warnings": [],
  "meta": {}
}
```

Error responses have `ok: false` and `errors` populated.

## Workflow: Setup (from zero)

```bash
# 1. Install CLI globally
bun add -g @gremlin/cli

# 2. Initialize (creates .gremlin/, installs SDK, writes config)
gremlin init --app-name my-app --json

# 3. Verify initialization
gremlin status --json
# Check: initialized=true, sdk.installed=true

# 4. Optionally auto-instrument entry point
gremlin init --instrument --json

# 5. For a remote server, pass --server-url to configure SDK endpoint
gremlin init --app-name my-app --server-url https://gremlin.example.com --json
```

## Workflow: Deploy

```bash
# Local dev server (foreground or background)
gremlin deploy local --json
gremlin deploy local --background --json

# Docker deployment (for VPS/production)
gremlin deploy docker --json
# Returns { url, apiKey } — use url as --server-url in init

# Check all deployments
gremlin deploy status --json

# Stop everything
gremlin deploy stop --json
```

## Workflow: Instrument

```bash
# Get framework-specific instrumentation guidance
gremlin instrument --json

# The SDK initialization code looks like:
#   import { GremlinRecorder } from '@gremlin/recorder-web';
#   const recorder = new GremlinRecorder({
#     appName: 'my-app',
#     serverUrl: 'https://gremlin.example.com',  // optional, defaults to localhost:3334
#   });
#   recorder.start();

# Add data-testid attributes to key interactive elements for reliable test generation
```

## Workflow: Record & Analyze

```bash
# 1. Start dev server (receives sessions from SDK)
gremlin dev --json
# Emits NDJSON: { event: "server_started", port, url }
# Then for each session: { event: "session_received", sessionId, ... }

# 2. User interacts with the app...

# 3. Check sessions
gremlin sessions --json

# 4. View aggregate analytics
gremlin analytics summary --json

# 5. Get AI-powered insights
gremlin analyze --json
# Returns: { insights: { summary, uxIssues, errors, patterns, recommendations } }
# Use --focus ux|errors|performance|all to narrow analysis
```

## Workflow: Test Generation

```bash
# 1. Generate tests from sessions
gremlin generate --json

# 2. Generate fuzz/chaos tests
gremlin fuzz --json

# 3. Run all generated tests
gremlin run --json
# Check: passed=true
```

## Workflow: Performance Regression Testing

```bash
# 1. Record sessions with perf data (use gremlin dev + interact with app)
gremlin sessions --json

# 2. Snapshot current perf as baseline (computes p75 budgets per Web Vital + per flow)
gremlin perf-baseline --json

# 3. Generate Playwright perf tests from baseline budgets
gremlin generate --perf --json

# 4. Run perf tests and detect regressions
gremlin run --perf --json
# Check: allPassed=true
```

| Command | Description | Key JSON fields |
|---------|-------------|-----------------|
| `gremlin perf-baseline` | Snapshot perf baseline | `{ path, sessionCount, flowCount, margin, baseline }` |
| `gremlin generate --perf` | Generate perf tests | `{ perfTests: [{flowName, path, stepCount}], outputDir, baselineUsed }` |
| `gremlin run --perf` | Run perf tests vs baseline | `{ flows: [{name, passed, metrics}], allPassed }` |

## MCP Server Setup

For direct tool integration (no subprocess spawning):

```json
{
  "mcpServers": {
    "gremlin": {
      "command": "bunx",
      "args": ["@gremlin/mcp"]
    }
  }
}
```

Available tools: `gremlin_status`, `gremlin_sessions_list`, `gremlin_session_get`, `gremlin_analytics_summary`, `gremlin_analyze`, `gremlin_generate_tests`, `gremlin_run_tests`, `gremlin_instrument_info`, `gremlin_init`, `gremlin_perf_baseline`, `gremlin_generate_perf_tests`, `gremlin_run_perf_tests`.

Resources: `gremlin://config`, `gremlin://sessions/{id}`, `gremlin://spec`, `gremlin://llms.txt`.

## Verification Patterns

After any mutation, run `gremlin status --json` to confirm state:

```bash
# After init
gremlin status --json | jq '.data.initialized'  # true

# After generate
gremlin status --json | jq '.data.tests.specExists'  # true

# After deploy
gremlin deploy status --json | jq '.data.local.running'  # true
```

## Project Architecture

- **Runtime:** Bun workspace, packages in `packages/*`
- **CLI:** `@gremlin/cli` — Commander.js, all commands in `packages/cli/src/commands/`
- **MCP:** `@gremlin/mcp` — Model Context Protocol server with stdio transport
- **Session types:** `@gremlin/session` — zero-dependency types package
- **Analysis:** `@gremlin/analysis` — AI-powered session analysis, test generation
- **Recorders:** `@gremlin/recorder-web`, `@gremlin/recorder-react-native`
- **Servers:** `@gremlin/server` (Cloudflare Worker), `@gremlin/server-node` (Bun + Hono)
- **Local data:** `.gremlin/sessions/`, `.gremlin/analytics/`, `.gremlin/tests/`, `.gremlin/config.json`

## Infrastructure

- **Local ingest:** `gremlin dev` on port 3334, sessions stored in `.gremlin/sessions/`
- **Self-hosted API:** `@gremlin/server-node`, Bun + Hono, filesystem storage
- **Cloud API:** `@gremlin/server`, Cloudflare Worker + R2
- **Docker:** `docker compose up --build` runs self-hosted API
- **Auth:** `API_KEY` required unless `DISABLE_AUTH=true`
- **Health:** `/health`, `/metrics` endpoints on dev and self-hosted servers

## Development

```bash
# Lint a specific package
bun run --filter '@gremlin/cli' lint

# Run all tests
bun run test

# Build all packages
bun run build
```
