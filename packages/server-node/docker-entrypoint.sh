#!/usr/bin/env bun

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { generateApiKey } from './src/keygen';

const dataDir = process.env.DATA_DIR ?? '/gremlin-data';
const authFile = process.env.GREMLIN_AUTH_FILE ?? join(dataDir, 'auth.json');
const disableAuth = parseBoolean(process.env.DISABLE_AUTH, false);

ensureDir(dataDir);

if (!disableAuth) {
  const existingKey = process.env.API_KEY;

  if (!existingKey) {
    const key = loadOrCreateKey(authFile);
    process.env.API_KEY = key;
  }
}

await spawnServer();

async function spawnServer(): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: process.env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode ?? 0);
}

function loadOrCreateKey(filePath: string): string {
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as { apiKey?: string };
      if (parsed.apiKey) {
        return parsed.apiKey;
      }
    } catch (error) {
      console.error('Failed to read existing auth file, regenerating.', error);
    }
  }

  const apiKey = generateApiKey();
  writeFileSync(filePath, JSON.stringify({ apiKey, createdAt: Date.now() }, null, 2));
  console.log(`Generated API key and stored at ${filePath}`);
  console.log(`API_KEY=${apiKey}`);
  return apiKey;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
