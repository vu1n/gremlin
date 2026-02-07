FROM oven/bun:1.1.40

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

WORKDIR /app/packages/server-node

EXPOSE 8787

ENTRYPOINT ["/app/packages/server-node/docker-entrypoint.sh"]
