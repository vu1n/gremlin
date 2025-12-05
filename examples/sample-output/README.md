# Sample Output

This folder contains example output from Gremlin's test generation pipeline.

## Contents

### `sessions/`
Sample recorded user sessions in GremlinSession format:
- `session-1.json` - Example e-commerce browsing session
- `session-2.json` - Example checkout flow session

### `tests/`
Generated tests from the sample sessions:

- **`playwright/`** - Playwright E2E tests for web
- **`maestro/`** - Maestro flows for React Native
- **`fuzz/`** - Fuzz tests (chaos testing scenarios)
- **`spec.json`** - GremlinSpec state machine model

## How This Was Generated

```bash
# 1. Record sessions (or import from rrweb/PostHog)
gremlin record --output sessions/

# 2. Generate GremlinSpec from sessions
gremlin generate --input sessions/ --output tests/

# 3. Run generated tests
gremlin run tests/playwright/
```

## Using as Reference

These files show the expected format for:
- Session recordings (input to test generation)
- Generated test files (output from AI pipeline)
- GremlinSpec state machine model (intermediate representation)

You can use these as templates or reference when building your own test generation workflows.
