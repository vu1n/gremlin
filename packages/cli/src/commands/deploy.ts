/**
 * Deploy Command
 *
 * Manages deployment of the Gremlin server in various modes:
 * - local: Start the dev server (foreground or background)
 * - docker: Start the self-hosted server via docker compose
 * - status: Check running server status
 * - stop: Stop running servers
 *
 * Usage:
 *   gremlin deploy local              # Start local dev server
 *   gremlin deploy local --background # Start in background
 *   gremlin deploy docker             # Start via docker compose
 *   gremlin deploy status             # Check what's running
 *   gremlin deploy stop               # Stop all servers
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface DeployLocalOptions extends OutputOptions {
  port?: number;
  background?: boolean;
}

export interface DeployLocalResult {
  status: 'started';
  port: number;
  url: string;
  pid?: number;
  background: boolean;
}

export interface DeployDockerOptions extends OutputOptions {
  port?: number;
  apiKey?: string;
  dataDir?: string;
  detach?: boolean;
}

export interface DeployDockerResult {
  status: 'started';
  port: number;
  url: string;
  apiKey: string;
  dataDir: string;
  containerId?: string;
}

export interface DeployStatusOptions extends OutputOptions {}

export interface DeployStatusResult {
  local: { running: boolean; port?: number; pid?: number; url?: string };
  docker: { running: boolean; port?: number; url?: string; containerId?: string };
  remote: { configured: boolean; url?: string; reachable?: boolean };
}

export interface DeployStopOptions extends OutputOptions {
  target?: 'local' | 'docker' | 'all';
}

export interface DeployStopResult {
  local: { stopped: boolean; pid?: number };
  docker: { stopped: boolean };
}

// ============================================================================
// Helpers
// ============================================================================

const GREMLIN_DIR = '.gremlin';
const PID_FILE = join(GREMLIN_DIR, 'dev.pid');
const CONFIG_FILE = join(GREMLIN_DIR, 'config.json');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function healthCheck(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(
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

// ============================================================================
// deployLocal
// ============================================================================

export async function deployLocal(options: DeployLocalOptions): Promise<DeployLocalResult> {
  const port = options.port ?? 3334;
  const background = options.background ?? false;
  const url = `http://localhost:${port}`;

  if (!background) {
    // Foreground mode: import and run dev server directly
    const { dev } = await import('./dev.ts');
    // dev() never returns (keeps server running), so this effectively blocks
    await dev({ port });
    // Unreachable, but satisfies return type
    return { status: 'started', port, url, background: false };
  }

  // Background mode: spawn detached child process
  ensureDir(GREMLIN_DIR);

  // Resolve CLI package directory (where src/index.ts lives)
  const cliDir = join(import.meta.dir, '..', '..');

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

  // Wait for health check: max 5 attempts, 500ms apart, 2s timeout each
  const healthy = await waitForHealth(`${url}/health`, 5, 500, 2000);

  const result: DeployLocalResult = {
    status: 'started',
    port,
    url,
    pid,
    background: true,
  };

  if (output('deploy.local', result, options)) return result;

  console.log('');
  console.log('  Gremlin Dev Server (background)');
  console.log('  ================================');
  console.log('');
  console.log(`  Status:   ${healthy ? 'Running' : 'Starting...'}`);
  console.log(`  URL:      ${url}`);
  if (pid) {
    console.log(`  PID:      ${pid}`);
  }
  console.log(`  PID file: ${PID_FILE}`);
  console.log('');
  if (healthy) {
    console.log('  Server is healthy and accepting connections.');
  } else {
    console.log('  Warning: Server did not respond to health check.');
    console.log('  It may still be starting up. Check with: gremlin deploy status');
  }
  console.log('');

  return result;
}

// ============================================================================
// deployDocker
// ============================================================================

export async function deployDocker(options: DeployDockerOptions): Promise<DeployDockerResult> {
  const port = options.port ?? 8787;
  const apiKey = options.apiKey || randomBytes(32).toString('hex');
  const dataDir = options.dataDir ?? '.gremlin/server-data';
  const detach = options.detach ?? true;
  const url = `http://localhost:${port}`;

  ensureDir(dataDir);

  // Build docker compose command args
  const args = ['compose', 'up', '--build'];
  if (detach) args.push('-d');

  // Set environment variables for docker compose
  const env = {
    ...process.env,
    API_KEY: apiKey,
    PORT: String(port),
    DATA_DIR: dataDir,
  };

  try {
    execSync(['docker', ...args].join(' '), {
      env,
      stdio: detach ? 'pipe' : 'inherit',
    });
  } catch (err) {
    const message = `Failed to start docker compose: ${err instanceof Error ? err.message : String(err)}`;
    outputError('deploy.docker', [message], options);
    if (!options.json) {
      console.error(`  Error: ${message}`);
    }
    throw err;
  }

  // Get container ID if detached
  let containerId: string | undefined;
  if (detach) {
    try {
      containerId = execSync('docker compose ps -q gremlin-server', { encoding: 'utf-8' }).trim();
    } catch {
      // Non-critical, continue without container ID
    }
  }

  // Wait for health check: max 10 attempts, 500ms apart, 5s timeout each
  const healthy = await waitForHealth(`${url}/health`, 10, 500, 5000);

  const result: DeployDockerResult = {
    status: 'started',
    port,
    url,
    apiKey,
    dataDir,
    containerId,
  };

  // Redact API key in JSON output to prevent leaking secrets in CI logs
  if (output('deploy.docker', { ...result, apiKey: apiKey.slice(0, 4) + '...' + apiKey.slice(-4) }, options)) return result;

  console.log('');
  console.log('  Gremlin Server (Docker)');
  console.log('  =======================');
  console.log('');
  console.log(`  Status:       ${healthy ? 'Running' : 'Starting...'}`);
  console.log(`  URL:          ${url}`);
  console.log(`  API Key:      ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);
  console.log(`  Data Dir:     ${dataDir}`);
  if (containerId) {
    console.log(`  Container:    ${containerId.slice(0, 12)}`);
  }
  console.log('');
  if (healthy) {
    console.log('  Server is healthy and accepting connections.');
  } else {
    console.log('  Warning: Server did not respond to health check.');
    console.log('  Check logs with: docker compose logs -f');
  }
  console.log('');
  console.log('  Configure your SDK:');
  console.log(`    serverUrl: "${url}"`);
  console.log(`    apiKey:    "${apiKey.slice(0, 4)}...${apiKey.slice(-4)}"`);
  console.log('');

  return result;
}

// ============================================================================
// deployStatus
// ============================================================================

export async function deployStatus(options: DeployStatusOptions): Promise<DeployStatusResult> {
  // Check local dev server
  const local: DeployStatusResult['local'] = { running: false };
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      // Check if process is alive
      process.kill(pid, 0);
      local.pid = pid;
      local.port = 3334;
      local.url = `http://localhost:${local.port}`;
      local.running = await healthCheck(`${local.url}/health`, 2000);
    } catch {
      // Process not running, stale PID file
    }
  }
  // Also try health check on default port even without PID file
  if (!local.running) {
    const defaultHealthy = await healthCheck('http://localhost:3334/health', 2000);
    if (defaultHealthy) {
      local.running = true;
      local.port = 3334;
      local.url = 'http://localhost:3334';
    }
  }

  // Check docker
  const docker: DeployStatusResult['docker'] = { running: false };
  try {
    const psOutput = execSync('docker compose ps --format json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (psOutput) {
      // docker compose ps --format json outputs one JSON object per line
      const lines = psOutput.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const container = JSON.parse(line);
          if (container.State === 'running' || container.Status?.startsWith('Up')) {
            docker.running = true;
            docker.containerId = container.ID;
            // Parse port from Publishers or Ports field
            const publishers = container.Publishers;
            if (Array.isArray(publishers) && publishers.length > 0) {
              docker.port = publishers[0].PublishedPort;
            }
            if (docker.port) {
              docker.url = `http://localhost:${docker.port}`;
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

  // Check remote
  const remote: DeployStatusResult['remote'] = { configured: false };
  if (existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.remoteServer?.url) {
        remote.configured = true;
        remote.url = config.remoteServer.url;
        remote.reachable = await healthCheck(`${remote.url}/health`, 5000);
      }
    } catch {
      // Invalid config file
    }
  }

  const result: DeployStatusResult = { local, docker, remote };

  if (output('deploy.status', result, options)) return result;

  console.log('');
  console.log('  Gremlin Server Status');
  console.log('  =====================');
  console.log('');

  // Local status
  console.log('  Local Dev Server:');
  if (local.running) {
    console.log(`    Status:   Running`);
    console.log(`    URL:      ${local.url}`);
    if (local.pid) console.log(`    PID:      ${local.pid}`);
  } else {
    console.log('    Status:   Not running');
  }
  console.log('');

  // Docker status
  console.log('  Docker Server:');
  if (docker.running) {
    console.log(`    Status:   Running`);
    if (docker.url) console.log(`    URL:      ${docker.url}`);
    if (docker.containerId) console.log(`    Container: ${docker.containerId.slice(0, 12)}`);
  } else {
    console.log('    Status:   Not running');
  }
  console.log('');

  // Remote status
  console.log('  Remote Server:');
  if (remote.configured) {
    console.log(`    URL:      ${remote.url}`);
    console.log(`    Status:   ${remote.reachable ? 'Reachable' : 'Unreachable'}`);
  } else {
    console.log('    Status:   Not configured');
  }
  console.log('');

  return result;
}

// ============================================================================
// deployStop
// ============================================================================

export async function deployStop(options: DeployStopOptions): Promise<DeployStopResult> {
  const target = options.target ?? 'all';

  const result: DeployStopResult = {
    local: { stopped: false },
    docker: { stopped: false },
  };

  // Stop local
  if (target === 'local' || target === 'all') {
    if (existsSync(PID_FILE)) {
      try {
        const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
        // Verify process exists before killing (pid 0 would signal the process group)
        if (pid > 0) {
          process.kill(pid, 0); // Check if alive without signaling
          process.kill(pid, 'SIGTERM');
          result.local = { stopped: true, pid };
        } else {
          result.local = { stopped: true };
        }
      } catch {
        // Process already gone or invalid PID
        result.local = { stopped: true };
      }
      try {
        unlinkSync(PID_FILE);
      } catch {
        // PID file already removed
      }
    }
  }

  // Stop docker
  if (target === 'docker' || target === 'all') {
    try {
      execSync('docker compose down', {
        stdio: 'pipe',
      });
      result.docker = { stopped: true };
    } catch {
      // docker compose not available or nothing to stop
    }
  }

  if (output('deploy.stop', result, options)) return result;

  console.log('');
  console.log('  Gremlin Server Stop');
  console.log('  ====================');
  console.log('');

  if (target === 'local' || target === 'all') {
    if (result.local.stopped) {
      console.log('  Local:    Stopped' + (result.local.pid ? ` (PID ${result.local.pid})` : ''));
    } else {
      console.log('  Local:    Not running');
    }
  }

  if (target === 'docker' || target === 'all') {
    if (result.docker.stopped) {
      console.log('  Docker:   Stopped');
    } else {
      console.log('  Docker:   Not running');
    }
  }

  console.log('');

  return result;
}
