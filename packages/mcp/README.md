# @gremlin/mcp

MCP (Model Context Protocol) server for Gremlin. Gives AI agents direct access to session data, test generation, analytics, and performance metrics without going through the CLI.

## What This Does

The MCP server exposes 14 tools and 4 resources that let AI agents:

- Check project status and configuration
- List and inspect recorded sessions
- Generate tests from sessions
- Run generated tests
- Query analytics and performance data
- Analyze sessions for UX issues and error patterns
- Create performance baselines and regression tests

## Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Claude Code

Add to `.claude/settings.json` or use `claude mcp add`:

```bash
claude mcp add gremlin -- bun run /path/to/gremlin/packages/mcp/src/index.ts
```

Or in `.claude/settings.json`:

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

### Cursor

Add to `.cursor/mcp.json`:

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

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

### Environment Variables

The MCP server inherits environment variables from its parent process. Set API keys for AI-powered features:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx   # or OPENAI_API_KEY or GEMINI_API_KEY
```

## Tools

### Project Management

| Tool | Description |
|------|-------------|
| `gremlin_status` | Full project status: config, session count, test counts, AI provider |
| `gremlin_init` | Initialize Gremlin in the current project |
| `gremlin_instrument_info` | Get framework-specific instrumentation guidance |

### Sessions

| Tool | Description |
|------|-------------|
| `gremlin_sessions_list` | List sessions with optional filters (app, platform, date, limit) |
| `gremlin_session_get` | Get full session data by ID |

### Test Generation & Execution

| Tool | Description |
|------|-------------|
| `gremlin_generate_tests` | Generate Playwright/Maestro tests from sessions |
| `gremlin_run_tests` | Run generated tests |
| `gremlin_generate_perf_tests` | Generate performance regression tests from baseline |
| `gremlin_run_perf_tests` | Run perf tests and compare against baseline |
| `gremlin_generate_error_tests` | Generate error regression tests from session patterns |

### Analytics & Insights

| Tool | Description |
|------|-------------|
| `gremlin_analytics_summary` | Aggregate analytics: events, errors, screens, duration |
| `gremlin_analytics_performance` | Performance metrics: Web Vitals, FPS, memory, long tasks with percentiles |
| `gremlin_analyze` | AI-powered insights: UX issues, errors, patterns, recommendations |
| `gremlin_error_patterns` | Deduplicated error patterns with occurrence counts |
| `gremlin_perf_baseline` | Snapshot performance metrics as regression baseline |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `gremlin://config` | Project configuration (`.gremlin/config.json`) |
| `gremlin://sessions/{id}` | Read a session by ID |
| `gremlin://spec` | GremlinSpec test specification (`.gremlin/tests/spec.json`) |
| `gremlin://llms.txt` | LLM-friendly instrumentation context |

## Example Agent Workflows

### New Project Setup

```
1. gremlin_init(appName: "my-app")
2. gremlin_status()                    → verify config, check AI key
3. gremlin_instrument_info()           → get SDK setup guidance
```

### Generate Tests from Sessions

```
1. gremlin_status()                    → check session count
2. gremlin_sessions_list(limit: 5)     → review available sessions
3. gremlin_generate_tests(provider: "anthropic")
4. gremlin_run_tests()                 → execute and verify
```

### Performance Audit

```
1. gremlin_analytics_performance()     → Web Vitals, FPS, memory aggregates
2. gremlin_sessions_list()             → find sessions to inspect
3. gremlin_session_get(sessionId: "abc") → drill into slow session
4. gremlin_analyze(focus: "performance") → AI insights on perf issues
5. gremlin_perf_baseline()             → set regression baseline
6. gremlin_generate_perf_tests()       → create perf regression tests
```

### Error Investigation

```
1. gremlin_error_patterns(minOccurrences: 2) → find recurring errors
2. gremlin_analyze(focus: "errors")          → AI analysis of error patterns
3. gremlin_generate_error_tests()            → create error regression tests
4. gremlin_run_tests()                       → verify tests pass
```

### UX Review

```
1. gremlin_analytics_summary()         → overview of user behavior
2. gremlin_analyze(focus: "ux")        → AI identifies UX problems
3. gremlin_sessions_list()             → find relevant sessions
4. gremlin_session_get(sessionId: "x") → inspect specific user journey
```

## Development

```bash
# Run directly
bun run packages/mcp/src/index.ts

# Build
bun run --filter '@gremlin/mcp' build

# Type check
bun run --filter '@gremlin/mcp' lint
```
