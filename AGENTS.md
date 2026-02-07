# Gremlin Agent Notes

- Runtime: Bun workspace with packages under `packages/*`.
- CLI local ingest: `gremlin dev` writes sessions to `.gremlin/sessions`.
- Self-hosted server: `@gremlin/server-node` (Bun + Hono, filesystem storage).
- Cloud server: `@gremlin/server` (Cloudflare Worker + R2).
- Docker: `docker compose up --build` runs the self-hosted server.
- Auth: `API_KEY` required unless `DISABLE_AUTH=true`.
- Docker bootstraps API key when empty; logs `API_KEY=...` and stores `DATA_DIR/auth.json`.
- Data layout: `DATA_DIR/sessions/*.json`, `DATA_DIR/index.json`.
- Use `bun run --filter '<package>' lint` for per-package linting.
- Avoid touching `.gremlin/` in the repo; it is local state.
