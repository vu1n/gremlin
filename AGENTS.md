# Gremlin Agent Notes

- Runtime: Bun workspace, packages in `packages/*`.
- Local ingest: `gremlin dev`, sessions in `.gremlin/sessions`.
- Self-hosted API: `@gremlin/server-node`, Bun + Hono, filesystem storage.
- Cloud API: `@gremlin/server`, Cloudflare Worker + R2.
- Docker: `docker compose up --build` runs self-hosted API.
- Auth: `API_KEY` required unless `DISABLE_AUTH=true`.
- Docker bootstrap: logs `API_KEY=...`, stores `DATA_DIR/auth.json`.
- Data layout: `DATA_DIR/sessions/*.json`, `DATA_DIR/index.json`.
- Health endpoints: `/health`, `/metrics` on dev and self-hosted server.
- Session listing: `gremlin sessions`.
- Linting: `bun run --filter '<package>' lint`.
- Repo state: avoid `.gremlin/` edits, local-only.
