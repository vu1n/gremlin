# Gremlin — Agent Bootstrap

> Copy this entire block into your AI coding agent (Claude, Cursor, Copilot, etc.) to set up Gremlin session recording, analytics, and automated test generation.

---

## What is Gremlin?

Gremlin records real user sessions in your app, then uses AI to analyze behavior, surface bugs, and generate automated tests. It works with React (Next.js, Vite, CRA, Remix) and React Native (Expo, bare RN).

## Setup Instructions

Run these commands in the project root. All commands return structured JSON with `--json`.

### Step 1: Install the CLI

```bash
bun add -g @gremlin/cli
```

If bun is not installed: `curl -fsSL https://bun.sh/install | bash`

### Step 2: Initialize the project

```bash
gremlin init --app-name <YOUR_APP_NAME> --json
```

This creates `.gremlin/` directory, detects your framework, installs the recorder SDK, and writes config.

Verify with:
```bash
gremlin status --json
```
Check that `data.initialized` is `true`.

### Step 3: Deploy a recording server

**Option A — Local (development):**
```bash
gremlin deploy local --background --json
```
Server runs on `localhost:3334`. No `--server-url` needed in init.

**Option B — Docker (VPS/production):**
```bash
gremlin deploy docker --port 8787 --json
```
Returns `{ url, apiKey }`. Use the URL in Step 4.

**Option C — Use existing server:**
If you already have a Gremlin server, pass its URL in Step 2:
```bash
gremlin init --app-name <YOUR_APP_NAME> --server-url https://your-server.example.com --json
```

### Step 4: Instrument the app

Get framework-specific instructions:
```bash
gremlin instrument --json
```

Or auto-instrument the detected entry point:
```bash
gremlin init --app-name <YOUR_APP_NAME> --instrument --json
```

**Manual instrumentation** — add this to your app's entry point (e.g., `src/main.tsx`, `pages/_app.tsx`, `App.tsx`):

```typescript
import { GremlinRecorder } from '@gremlin/recorder-web';
// For React Native: import { GremlinRecorder } from '@gremlin/recorder-react-native';

const recorder = new GremlinRecorder({
  appName: '<YOUR_APP_NAME>',
  // serverUrl: 'https://your-server.example.com',  // only if using remote server
});

recorder.start();
```

Important:
- Initialize ONCE at the app root, not inside components
- Add `data-testid` attributes to key interactive elements for better test generation
- Password fields are automatically masked

### Step 5: Verify end-to-end

```bash
gremlin status --json
```

Confirm:
- `data.initialized` = true
- `data.devServer.running` = true (if using local deploy)
- `data.sdk.installed` = true

Then use the app. Sessions will appear in:
```bash
gremlin sessions --json
```

## What to do with recordings

### View analytics
```bash
gremlin analytics summary --json    # Aggregate stats: sessions, events, errors, platforms
gremlin analytics errors --json     # Error breakdown
```

### Get AI insights
```bash
gremlin analyze --json              # Full analysis: UX issues, errors, patterns, recommendations
gremlin analyze --focus errors --json   # Focus on errors only
gremlin analyze --focus ux --json       # Focus on UX issues only
```

### Generate automated tests
```bash
gremlin generate --json             # Generate Playwright tests from session behavior
gremlin fuzz --json                 # Generate fuzz/chaos tests
gremlin run --json                  # Run all generated tests
```

### Performance regression testing
```bash
gremlin perf-baseline --json        # Snapshot current perf as baseline
gremlin generate --perf --json      # Generate Playwright perf tests
gremlin run --perf --json           # Run perf tests, detect regressions
```

### Error regression testing
```bash
gremlin errors --json               # List error patterns across sessions
gremlin generate --errors --json    # Generate regression tests for errors
gremlin run --json                  # Run all tests including error regressions
```

## MCP Integration (optional)

For direct tool access without CLI subprocess spawning, add to your MCP config:

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

Tools: `gremlin_status`, `gremlin_analyze`, `gremlin_sessions_list`, `gremlin_session_get`, `gremlin_analytics_summary`, `gremlin_generate_tests`, `gremlin_run_tests`, `gremlin_instrument_info`, `gremlin_init`, `gremlin_perf_baseline`, `gremlin_generate_perf_tests`, `gremlin_run_perf_tests`, `gremlin_error_patterns`, `gremlin_generate_error_tests`.

## Command Reference

All commands support `--json` for machine-readable output. JSON output uses envelope: `{ ok, command, data, errors?, warnings? }`.

| Command | What it does |
|---------|-------------|
| `gremlin init` | Initialize project, install SDK, write config |
| `gremlin status` | Full project state check |
| `gremlin dev` | Start local dev server (receives sessions) |
| `gremlin sessions` | List recorded sessions |
| `gremlin analyze` | AI-powered insights from sessions |
| `gremlin generate` | Generate Playwright/Maestro tests |
| `gremlin fuzz` | Generate fuzz/chaos tests |
| `gremlin run` | Run generated tests |
| `gremlin instrument` | Get instrumentation guidance |
| `gremlin analytics summary` | Aggregate session analytics |
| `gremlin analytics errors` | Error breakdown |
| `gremlin deploy local` | Start local server |
| `gremlin deploy docker` | Deploy with Docker |
| `gremlin deploy status` | Check deployments |
| `gremlin deploy stop` | Stop deployments |
| `gremlin import` | Import sessions from PostHog or rrweb files |
| `gremlin errors` | List error patterns across sessions |
| `gremlin errors --generate` | Generate error regression tests |
| `gremlin generate --errors` | Generate error regression tests |
| `gremlin perf-baseline` | Snapshot current perf metrics as baseline |
| `gremlin generate --perf` | Generate perf regression tests |
| `gremlin run --perf` | Run perf tests, compare against baseline |

## Verification

After any step, run `gremlin status --json` to confirm state. Always check `ok: true` in JSON output before proceeding to the next step.
