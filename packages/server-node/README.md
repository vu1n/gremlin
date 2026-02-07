# @gremlin/server-node

Self-hosted Gremlin session storage server built on Bun + Hono.

## Why

- Run on any VPS or container platform
- Keep session data in your own storage
- Minimal ops: a single server + a data folder

## Quick Start

```bash
# From repo root
bun install
bun run --filter '@gremlin/server-node' dev
```

Server starts on `http://localhost:8787` by default.

## Docker

From repo root:

```bash
docker compose up --build
```

The container auto-generates an API key on first boot if `API_KEY` is not set
and `DISABLE_AUTH=false`. The key is stored at `DATA_DIR/auth.json`.

## API Key

Generate a secure API key:

```bash
bun run --filter '@gremlin/server-node' keygen
```

Set `API_KEY` in your environment or compose file. For local dev, you can set
`DISABLE_AUTH=true` to bypass auth checks.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Port for the HTTP server |
| `DATA_DIR` | `./.gremlin/data` | Directory for session storage |
| `API_KEY` | empty | Required when `DISABLE_AUTH=false` |
| `DISABLE_AUTH` | `false` | Disable API key checks (local dev only) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS allowlist |
| `GREMLIN_AUTH_FILE` | `${DATA_DIR}/auth.json` | Path to store generated API key |

## API

The API matches `@gremlin/server` (Cloudflare Worker). See
[packages/server/README.md](file:///Users/vuln/code/gremlin/packages/server/README.md) for the endpoint list.

## Data Layout

```
DATA_DIR/
  sessions/
    {session-id}.json
  index.json
  auth.json
```

- `sessions/*` stores full session JSON
- `index.json` stores lightweight metadata for list responses
- `auth.json` stores a generated API key when using Docker bootstrapping

## Security Notes

- Production deployments should set `DISABLE_AUTH=false` and provide `API_KEY`.
- Set `ALLOWED_ORIGINS` to your app domain.

