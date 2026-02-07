/**
 * Configuration loader
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { ServerConfig } from './types';

const DEFAULT_PORT = 8787;
const DEFAULT_DATA_DIR = './.gremlin/data';

export function getConfig(): ServerConfig {
  const port = parseInt(process.env.PORT ?? '', 10);
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  const apiKey = process.env.API_KEY;
  const disableAuth = parseBoolean(process.env.DISABLE_AUTH, false);
  const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS ?? '*');

  return {
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    dataDir,
    apiKey,
    disableAuth,
    allowedOrigins,
  };
}

export function ensureDataLayout(config: ServerConfig): void {
  const sessionsDir = join(config.dataDir, 'sessions');

  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }

  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseOrigins(value: string): string | string[] {
  if (value === '*') {
    return '*';
  }

  const parts = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return '*';
  }

  return parts.length === 1 ? parts[0] : parts;
}
