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

## Architecture

Gremlin ships a local-first workflow plus two server options:

- **Recorder SDKs** (`@gremlin/recorder-web`, `@gremlin/recorder-react-native`)
- **CLI** for local ingest (`gremlin dev`) and test generation
- **Self-hosted API** (`@gremlin/server-node`) for VPS/container deployments
- **Cloudflare Worker API** (`@gremlin/server`) for serverless deployments

## Quick Start

Get started with three commands. Gremlin auto-detects your framework, instruments your app, and generates tests from real user sessions.

```bash
# Install
bun add -g @gremlin/cli

# Initialize (auto-instruments your app)
gremlin init

# Start recording sessions
gremlin dev          # Terminal 1
bun run dev          # Terminal 2 - your app
```

Use your app for a few minutes. Gremlin captures clicks, navigation, inputs, and errors automatically.

```bash
# Generate tests from your sessions
gremlin generate

# Run the tests
gremlin run
```

That's it. You now have Playwright tests based on real user behavior.

---

### What Just Happened?

1. **`gremlin init`** detected your framework (Next.js, Vite, Remix, etc.), installed the SDK, and auto-instrumented your app's entry point
2. **`gremlin dev`** started a local server that receives sessions from your app
3. As you used your app, sessions were recorded to `.gremlin/sessions/`
4. **`gremlin generate`** analyzed those sessions with AI and generated executable tests
5. **`gremlin run`** executed the generated tests

---

## Framework Support

Gremlin auto-detects and instruments:

- **Web**: Next.js, Vite, Create React App, Remix
- **Mobile**: Expo, React Native

---

## Generate Tests

```bash
gremlin generate
```

This analyzes your sessions using AI and generates:
- Playwright tests for web apps
- Maestro flows for mobile apps
- A state machine model (`spec.json`) of your app

**Requires an AI provider API key:**
```bash
export ANTHROPIC_API_KEY=sk-ant-xxx  # Recommended
# or
export OPENAI_API_KEY=sk-xxx
# or
export GEMINI_API_KEY=xxx
```

---

## Generate Fuzz Tests

Find edge cases with chaos testing:

```bash
gremlin fuzz --strategy all --count 20
```

Strategies: random-walk, boundary abuse, sequence mutation, back-button chaos.

---

## Import Existing Sessions

Already using session recording? Import from PostHog or rrweb files:

```bash
# Import from PostHog
gremlin import --posthog --api-key=phx_xxx --project-id=123 --limit=5

# Import rrweb JSON file
gremlin import --file ./recording.json

# Then generate tests
gremlin generate
```

---

## Run Tests

```bash
# All tests
gremlin run

# Specific framework
npx playwright test .gremlin/tests/playwright
maestro test .gremlin/tests/maestro
```

---

## Manual SDK Setup

If you need fine-grained control or auto-instrumentation didn't work, you can manually integrate the SDK.

### Web Apps

```bash
bun add @gremlin/recorder-web
```

```typescript
import { GremlinRecorder } from '@gremlin/recorder-web';

const recorder = new GremlinRecorder({
  appName: 'my-app',
  appVersion: '1.0.0',
  autoStart: true,              // Start recording immediately
  capturePerformance: true,      // Capture memory/timing metrics
  maskInputs: true,              // Mask passwords/emails
  persistSession: true,          // Continue recording across page loads
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
  capturePerformance: true,
});

recorder.start();
```

### Disable Auto-Instrumentation

If you prefer manual setup:

```bash
gremlin init --no-instrument
```

---

## Self-Hosted Session API

For teams that want full data ownership, Gremlin ships a self-hosted API server
built on Bun + Hono. This can run on a VPS or any container platform and stores
sessions as JSON files on disk.

### Quick Start (Docker)

```bash
docker compose up --build
```

The container prints `API_KEY=...` if it generates a key on first boot.

### VPS Quick Start

```bash
git clone https://github.com/yourusername/gremlin.git
cd gremlin
docker compose up --build -d
```

### API Key Setup

Generate a key:

```bash
bun run --filter '@gremlin/server-node' keygen
```

If you're using Docker and leave `API_KEY` empty, the container generates one
on first boot and stores it at `DATA_DIR/auth.json`.

For local dev, you can set `DISABLE_AUTH=true`.

### Data Portability

All sessions are stored as plain JSON files in `DATA_DIR/sessions`. You can
archive or sync this directory to move data between environments. The
`DATA_DIR/index.json` file is derived metadata and can be regenerated by
re-ingesting sessions if needed.

### Default Port

The server runs on `http://localhost:8787` by default.

## Dev Hardening

Gremlin defaults are tuned for dev workflows:

- Local ingest via `gremlin dev` with `/health` and `/metrics` endpoints.
- Self-hosted server exposes `/health` and `/metrics` for quick checks.
- Session writes are atomic to avoid partial files on crash.
- SDK transports retry transient failures with backoff.
- `gremlin sessions` lists recorded sessions quickly.

## Agent Workflow

Gremlin supports AI agent workflows via `gremlin instrument --llms`, which
prints an `llms.txt` block with project-specific instrumentation guidance.

CLI help excerpt:

```text
Dev workflow:
  gremlin dev
  gremlin sessions
  gremlin replay latest
  gremlin generate

Agent workflow:
  gremlin instrument --llms
  gremlin dev
  gremlin sessions
  gremlin generate
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
│   ├── server/                 # Session storage server (Cloudflare Worker)
│   └── server-node/            # Self-hosted session server (Bun)
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
