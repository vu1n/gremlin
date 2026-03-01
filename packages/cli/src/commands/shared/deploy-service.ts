/**
 * Deploy Service
 *
 * Handles infrastructure concerns for the deploy command:
 * - Process management (PID file handling, spawning background servers)
 * - Docker orchestration (compose up/down, container discovery)
 * - Health checking and port detection
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { ensureDir } from './sessions.ts';

const GREMLIN_DIR = '.gremlin';
const PID_FILE = join(GREMLIN_DIR, 'dev.pid');
const CONFIG_FILE = join(GREMLIN_DIR, 'config.json');

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function getConfigPort(): number | undefined {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    return config.devServer?.port;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Health checking
// ---------------------------------------------------------------------------

export async function isPortInUse(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function healthCheck(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHealth(
  url: string,
  maxAttempts: number,
  intervalMs: number,
  perAttemptTimeoutMs: number,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await healthCheck(url, perAttemptTimeoutMs)) {
      return true;
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// PID / local process management
// ---------------------------------------------------------------------------

/**
 * Check the PID file. Returns the PID if the process is still alive,
 * cleans up the stale file and returns null otherwise.
 * Throws if the process is alive (i.e. server already running).
 */
export function checkExistingLocalServer(): number | null {
  if (!existsSync(PID_FILE)) return null;

  try {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (oldPid > 0) {
      process.kill(oldPid, 0); // throws if not alive
      return oldPid; // process is alive
    }
  } catch {
    // Dead process, clean stale PID
    try { unlinkSync(PID_FILE); } catch {}
  }
  return null;
}

/**
 * Spawn a background dev server process and write its PID file.
 */
export function spawnBackgroundServer(port: number): number | undefined {
  ensureDir(GREMLIN_DIR);

  // Resolve CLI package directory (where src/index.ts lives)
  const cliDir = join(import.meta.dir, '..', '..', '..');

  const child = spawn('bun', ['run', './src/index.ts', 'dev', '--port', String(port)], {
    cwd: cliDir,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  const pid = child.pid;
  if (pid) {
    writeFileSync(PID_FILE, String(pid));
  }
  return pid;
}

/**
 * Stop the local dev server by killing the PID from the PID file.
 * Returns the PID that was stopped, or undefined if nothing was running.
 */
export function stopLocalServer(): { stopped: boolean; pid?: number } {
  if (!existsSync(PID_FILE)) {
    return { stopped: false };
  }

  let stoppedPid: number | undefined;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (pid > 0) {
      process.kill(pid, 0); // Check if alive
      process.kill(pid, 'SIGTERM');
      stoppedPid = pid;
    }
  } catch {
    // Process already gone or invalid PID
  }

  try {
    unlinkSync(PID_FILE);
  } catch {
    // PID file already removed
  }

  return { stopped: true, pid: stoppedPid };
}

// ---------------------------------------------------------------------------
// Docker orchestration
// ---------------------------------------------------------------------------

/**
 * Ensure Docker is available. Throws with a descriptive message if not.
 */
export function assertDockerAvailable(): void {
  const dockerCheck = spawnSync('docker', ['info'], { stdio: 'pipe', shell: false });
  if (dockerCheck.status !== 0) {
    throw new Error('Docker is not running or not installed. Install Docker from https://docs.docker.com/get-docker/');
  }
}

/**
 * Resolve or generate a persistent API key for docker deploys.
 */
export function resolveApiKey(explicitKey?: string): string {
  const keyFile = join(GREMLIN_DIR, 'docker-api-key');

  if (explicitKey) return explicitKey;

  if (existsSync(keyFile)) {
    return readFileSync(keyFile, 'utf-8').trim();
  }

  const apiKey = randomBytes(32).toString('hex');
  ensureDir(GREMLIN_DIR);
  writeFileSync(keyFile, apiKey, { mode: 0o600 });
  return apiKey;
}

/**
 * Start docker compose. Returns the container ID if detached.
 */
export function startDockerCompose(options: {
  port: number;
  apiKey: string;
  dataDir: string;
  detach: boolean;
}): string | undefined {
  ensureDir(options.dataDir);

  // Build docker compose command args -- skip --build if image already exists
  const hasImage = spawnSync('docker', ['compose', 'images', '-q'], { stdio: 'pipe', shell: false });
  const needsBuild = !hasImage.stdout?.toString().trim();
  const args = ['compose', 'up'];
  if (needsBuild) args.push('--build');
  if (options.detach) args.push('-d');

  const env = {
    ...process.env,
    API_KEY: options.apiKey,
    PORT: String(options.port),
    DATA_DIR: options.dataDir,
  };

  const result = spawnSync('docker', args, {
    env,
    stdio: options.detach ? 'pipe' : 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`docker compose failed with exit code ${result.status}`);
  }

  // Get container ID if detached
  if (options.detach) {
    try {
      const psResult = spawnSync('docker', ['compose', 'ps', '-q', 'gremlin-server'], {
        encoding: 'utf-8',
        shell: false,
      });
      if (psResult.stdout) {
        return psResult.stdout.trim() || undefined;
      }
    } catch {
      // Non-critical
    }
  }

  return undefined;
}

/**
 * Check docker compose status. Returns running container info if found.
 */
export function checkDockerStatus(): {
  running: boolean;
  port?: number;
  url?: string;
  containerId?: string;
} {
  const result: { running: boolean; port?: number; url?: string; containerId?: string } = {
    running: false,
  };

  try {
    const psResult = spawnSync('docker', ['compose', 'ps', '--format', 'json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    const psOutput = psResult.stdout?.trim();
    if (psOutput) {
      const lines = psOutput.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const container = JSON.parse(line);
          if (container.State === 'running' || container.Status?.startsWith('Up')) {
            result.running = true;
            result.containerId = container.ID;
            const publishers = container.Publishers;
            if (Array.isArray(publishers) && publishers.length > 0) {
              result.port = publishers[0].PublishedPort;
            }
            if (result.port) {
              result.url = `http://localhost:${result.port}`;
            }
            break;
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch {
    // docker compose not available or not configured
  }

  return result;
}

/**
 * Stop docker compose. Returns whether it was stopped successfully.
 */
export function stopDockerCompose(): boolean {
  try {
    const result = spawnSync('docker', ['compose', 'down'], {
      stdio: 'pipe',
      shell: false,
    });
    return result.status === 0;
  } catch {
    return true; // Nothing to stop
  }
}

/**
 * Check remote server configuration and reachability.
 */
export async function checkRemoteStatus(): Promise<{
  configured: boolean;
  url?: string;
  reachable?: boolean;
}> {
  const result: { configured: boolean; url?: string; reachable?: boolean } = {
    configured: false,
  };

  if (existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.remoteServer?.url) {
        result.configured = true;
        result.url = config.remoteServer.url;
        result.reachable = await healthCheck(`${result.url}/health`, 5000);
      }
    } catch {
      // Invalid config file
    }
  }

  return result;
}
