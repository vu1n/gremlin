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

import { output, outputError, type OutputOptions } from '../output.ts';
import {
  getConfigPort,
  isPortInUse,
  waitForHealth,
  healthCheck,
  checkExistingLocalServer,
  spawnBackgroundServer,
  stopLocalServer,
  assertDockerAvailable,
  resolveApiKey,
  startDockerCompose,
  checkDockerStatus,
  stopDockerCompose,
  checkRemoteStatus,
} from './shared/deploy-service.ts';

interface DeployLocalOptions extends OutputOptions {
  port?: number;
  background?: boolean;
}

interface DeployLocalResult {
  status: 'started';
  port: number;
  url: string;
  pid?: number;
  background: boolean;
}

interface DeployDockerOptions extends OutputOptions {
  port?: number;
  apiKey?: string;
  dataDir?: string;
  detach?: boolean;
}

interface DeployDockerResult {
  status: 'started';
  port: number;
  url: string;
  apiKey: string;
  dataDir: string;
  containerId?: string;
}

interface DeployStatusOptions extends OutputOptions {}

interface DeployStatusResult {
  local: { running: boolean; port?: number; pid?: number; url?: string };
  docker: { running: boolean; port?: number; url?: string; containerId?: string };
  remote: { configured: boolean; url?: string; reachable?: boolean };
}

interface DeployStopOptions extends OutputOptions {
  target?: 'local' | 'docker' | 'all';
}

interface DeployStopResult {
  local: { stopped: boolean; pid?: number };
  docker: { stopped: boolean };
}

export async function deployLocal(options: DeployLocalOptions): Promise<DeployLocalResult> {
  const port = options.port ?? getConfigPort() ?? 3334;
  const background = options.background ?? false;
  const url = `http://localhost:${port}`;

  // Check for existing server process
  const existingPid = checkExistingLocalServer();
  if (existingPid !== null) {
    const msg = `Gremlin server already running (PID ${existingPid}). Stop it first: gremlin deploy stop`;
    outputError('deploy.local', [msg], options);
    if (!options.json) console.error(`  Error: ${msg}`);
    throw new Error(msg);
  }

  // Check if port is already in use by another process
  if (await isPortInUse(port)) {
    const msg = `Port ${port} is already in use. Choose a different port with --port or stop the existing process.`;
    outputError('deploy.local', [msg], options);
    if (!options.json) console.error(`  Error: ${msg}`);
    throw new Error(msg);
  }

  if (!background) {
    // Foreground mode: import and run dev server directly
    const { dev } = await import('./dev.ts');
    // dev() never returns (keeps server running), so this effectively blocks
    await dev({ port });
    // Unreachable, but satisfies return type
    return { status: 'started', port, url, background: false };
  }

  // Background mode: spawn detached child process
  const pid = spawnBackgroundServer(port);

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
  console.log(`  PID file: .gremlin/dev.pid`);
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

export async function deployDocker(options: DeployDockerOptions): Promise<DeployDockerResult> {
  const port = options.port ?? 8787;
  const dataDir = options.dataDir ?? '.gremlin/server-data';
  const detach = options.detach ?? true;
  const url = `http://localhost:${port}`;

  // Check if docker is available
  try {
    assertDockerAvailable();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputError('deploy.docker', [msg], options);
    if (!options.json) console.error(`  Error: ${msg}`);
    throw err;
  }

  // Resolve API key (persisted across deploys)
  const apiKey = resolveApiKey(options.apiKey);

  // Start docker compose
  let containerId: string | undefined;
  try {
    containerId = startDockerCompose({ port, apiKey, dataDir, detach });
  } catch (err) {
    const message = `Failed to start docker compose: ${err instanceof Error ? err.message : String(err)}`;
    outputError('deploy.docker', [message], options);
    if (!options.json) {
      console.error(`  Error: ${message}`);
    }
    throw err;
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
  console.log(`  API Key:      ${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-4)}`);
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
  console.log(`    apiKey:    "${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-4)}"`);
  console.log('');

  return result;
}

export async function deployStatus(options: DeployStatusOptions): Promise<DeployStatusResult> {
  // Check local dev server
  const configPort = getConfigPort() ?? 3334;
  const local: DeployStatusResult['local'] = { running: false };

  const existingPid = checkExistingLocalServer();
  if (existingPid !== null) {
    local.pid = existingPid;
    local.port = configPort;
    local.url = `http://localhost:${local.port}`;
    local.running = await healthCheck(`${local.url}/health`, 2000);
  }

  // Also try health check on configured port even without PID file
  if (!local.running) {
    const defaultHealthy = await healthCheck(`http://localhost:${configPort}/health`, 2000);
    if (defaultHealthy) {
      local.running = true;
      local.port = configPort;
      local.url = `http://localhost:${configPort}`;
    }
  }

  // Check docker
  const docker: DeployStatusResult['docker'] = checkDockerStatus();

  // Check remote
  const remote: DeployStatusResult['remote'] = await checkRemoteStatus();

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

export function deployStop(options: DeployStopOptions): DeployStopResult {
  const target = options.target ?? 'all';

  const result: DeployStopResult = {
    local: { stopped: false },
    docker: { stopped: false },
  };

  // Stop local
  if (target === 'local' || target === 'all') {
    result.local = stopLocalServer();
  }

  // Stop docker
  if (target === 'docker' || target === 'all') {
    result.docker = { stopped: stopDockerCompose() };
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
