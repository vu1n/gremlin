/**
 * Init Command
 *
 * Initializes Gremlin in the current project: creates .gremlin/ directory
 * structure, writes config, installs the SDK, and optionally instruments
 * the app entry point.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync, copyFileSync } from 'fs';
import { join, basename, resolve } from 'path';
import { spawnSync } from 'child_process';
import { detectFramework, formatFramework, getFrameworkInfo, findEntryPoint, getInitCode, type Framework } from '../detect.ts';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface InitOptions extends OutputOptions {
  appName?: string;
  framework?: string;
  skipInstall?: boolean;
  instrument?: boolean;
  serverUrl?: string;
  force?: boolean;
}

export interface InitResult {
  initialized: true;
  framework: Framework;
  frameworkDisplay: string;
  appName: string;
  sdkPackage: string;
  configPath: string;
  directories: string[];
  instrumented?: boolean;
  instrumentedFile?: string;
  gitignoreUpdated: boolean;
}

// ============================================================================
// Main Command
// ============================================================================

export async function init(options: InitOptions): Promise<InitResult> {
  const cwd = process.cwd();

  // --- Detect framework ---
  const framework: Framework = options.framework
    ? (options.framework as Framework)
    : detectFramework();

  const info = getFrameworkInfo(framework);

  // --- Resolve app name ---
  let appName = options.appName;
  if (!appName) {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        appName = pkg.name;
      } catch {
        // ignore parse errors
      }
    }
  }
  if (!appName) appName = 'my-app';

  // --- Check for existing .gremlin directory ---
  const gremlinDir = join(cwd, '.gremlin');
  if (existsSync(join(gremlinDir, 'config.json')) && !options.force) {
    const msg = '.gremlin/config.json already exists. Use --force to reinitialize.';
    if (!outputError('init', [msg], options)) {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }

  if (!options.json) {
    console.log('');
    console.log('Gremlin Init');
    console.log('============');
    console.log('');
    console.log(`  Framework:  ${formatFramework(framework)}`);
    console.log(`  App name:   ${appName}`);
    console.log(`  SDK:        ${info.sdkPackage}`);
    console.log('');
  }

  // --- Create directory structure ---
  const directories = [
    '.gremlin',
    '.gremlin/sessions',
    '.gremlin/analytics',
    '.gremlin/tests',
  ];

  for (const dir of directories) {
    mkdirSync(join(cwd, dir), { recursive: true });
  }

  if (!options.json) {
    console.log('  [x] Created .gremlin/ directory structure');
  }

  // --- Write config ---
  const configPath = join(gremlinDir, 'config.json');
  const config = {
    framework,
    appName,
    sdkPackage: info.sdkPackage,
    devServer: { port: 3334 },
    remoteServer: { url: options.serverUrl ?? null },
    createdAt: new Date().toISOString(),
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  if (!options.json) {
    console.log('  [x] Wrote .gremlin/config.json');
  }

  // --- Install SDK ---
  if (!options.skipInstall) {
    if (!options.json) {
      console.log(`  [ ] Installing ${info.sdkPackage}...`);
    }
    // Use spawnSync with argument array to prevent command injection
    const result = spawnSync('bun', ['add', info.sdkPackage], {
      cwd,
      stdio: 'pipe',
      shell: false,
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || '';
      const msg = `Failed to install ${info.sdkPackage}: ${stderr || 'exit code ' + result.status}`;
      if (!outputError('init', [msg], options)) {
        console.error(`  Error: ${msg}`);
        console.error(`  Run manually: ${info.installCommand}`);
      }
      process.exit(1);
    }

    if (!options.json) {
      console.log(`  [x] Installed ${info.sdkPackage}`);
    }
  } else {
    if (!options.json) {
      console.log(`  [-] Skipped SDK install (--skip-install)`);
    }
  }

  // --- Instrument entry point ---
  let instrumented = false;
  let instrumentedFile: string | undefined;

  if (options.instrument) {
    const entryPoint = findEntryPoint(framework);
    if (entryPoint) {
      // Resolve and validate path to prevent directory traversal
      const fullPath = resolve(cwd, entryPoint);

      // Ensure the resolved path is within the current working directory
      if (!fullPath.startsWith(resolve(cwd))) {
        const msg = `Security error: Invalid entry point path (potential path traversal attack)`;
        if (!outputError('init', [msg], options)) {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const backupPath = fullPath + '.gremlin-backup';
      const original = readFileSync(fullPath, 'utf-8');

      copyFileSync(fullPath, backupPath);

      const initCode = getInitCode(framework, { appName, serverUrl: options.serverUrl });
      const injected = injectInitCode(original, initCode);

      writeFileSync(fullPath, injected);
      instrumented = true;
      instrumentedFile = entryPoint;

      if (!options.json) {
        console.log(`  [x] Instrumented ${entryPoint}`);
        console.log(`      Backup saved to ${basename(backupPath)}`);
      }
    } else {
      if (!options.json) {
        console.log(`  [!] Could not find entry point to instrument`);
        console.log(`      ${info.entryPointHint}`);
      }
    }
  }

  // --- Update .gitignore ---
  let gitignoreUpdated = false;
  const gitignorePath = join(cwd, '.gitignore');

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.gremlin/')) {
      appendFileSync(gitignorePath, '\n# Gremlin local data\n.gremlin/\n');
      gitignoreUpdated = true;
    }
  } else {
    writeFileSync(gitignorePath, '# Gremlin local data\n.gremlin/\n');
    gitignoreUpdated = true;
  }

  if (!options.json) {
    if (gitignoreUpdated) {
      console.log('  [x] Added .gremlin/ to .gitignore');
    } else {
      console.log('  [-] .gremlin/ already in .gitignore');
    }
  }

  // --- Write llms.txt ---
  const llmsTxtPath = join(gremlinDir, 'llms.txt');
  writeFileSync(llmsTxtPath, generateLlmsTxt(framework, appName, info.sdkPackage, options.serverUrl));

  if (!options.json) {
    console.log('  [x] Wrote .gremlin/llms.txt (agent guidance)');
  }

  // --- Result ---
  const result: InitResult = {
    initialized: true,
    framework,
    frameworkDisplay: info.displayName,
    appName,
    sdkPackage: info.sdkPackage,
    configPath: '.gremlin/config.json',
    directories,
    instrumented: instrumented || undefined,
    instrumentedFile,
    gitignoreUpdated,
  };

  if (output('init', result, options)) return result;

  // --- Human-readable next steps ---
  console.log('');
  console.log('Next steps:');
  if (!instrumented) {
    console.log('  1. Instrument your app:');
    console.log('     gremlin instrument    # Get AI-friendly instructions');
    console.log('');
    console.log('  2. Start the dev server:');
    console.log('     gremlin dev');
  } else {
    console.log('  1. Start the Gremlin dev server:');
    console.log('     gremlin dev');
    console.log('');
    console.log('  2. In another terminal, start your app:');
    console.log(`     ${info.devCommand || 'bun run dev'}`);
  }
  console.log('');
  console.log('  3. Use your app for a few minutes to record sessions');
  console.log('');
  console.log('  Then generate tests:');
  console.log('     gremlin sessions       # List recordings');
  console.log('     gremlin generate       # Generate tests from sessions');
  console.log('     gremlin run            # Run generated tests');
  console.log('');

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Inject init code after existing imports in a source file.
 */
function injectInitCode(source: string, initCode: string): string {
  const lines = source.split('\n');
  let lastImportIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.startsWith('import ') ||
      line.startsWith('import{') ||
      line.startsWith("import '") ||
      line.startsWith('import "') ||
      line.startsWith('from ') ||
      line.startsWith('} from ')
    ) {
      lastImportIndex = i;
    }
  }

  const insertAt = lastImportIndex + 1;
  lines.splice(insertAt, 0, '', initCode, '');

  return lines.join('\n');
}

/**
 * Generate framework-specific llms.txt agent guidance.
 */
function generateLlmsTxt(framework: Framework, appName: string, sdkPackage: string, serverUrl?: string): string {
  const serverNote = serverUrl
    ? `- Server: ${serverUrl} (SDK sends recordings here)`
    : '- Server: localhost:3334 (run \`gremlin dev\` or \`gremlin deploy local\`)';

  return `# Gremlin - ${appName}

> AI-powered session recording, analytics, and test generation

## Project Setup
- Framework: ${formatFramework(framework)}
- SDK: ${sdkPackage}
- Config: .gremlin/config.json
${serverNote}

## Directory Structure
- .gremlin/sessions/   - Recorded user sessions (JSON)
- .gremlin/analytics/  - Session analytics data
- .gremlin/tests/      - Generated test files
- .gremlin/config.json - Project configuration

## CLI Commands (all support --json)
\`\`\`bash
# Status & setup
gremlin status --json           # Full project state check
gremlin init --json             # Re-initialize if needed

# Recording
gremlin dev --json              # Start local dev server (receives sessions)
gremlin sessions --json         # List recorded sessions

# Analysis
gremlin analyze --json          # AI-powered insights from sessions
gremlin analytics summary --json # Aggregate stats
gremlin analytics errors --json  # Error breakdown

# Test generation
gremlin generate --json         # Generate Playwright/Maestro tests from sessions
gremlin fuzz --json             # Generate fuzz/chaos tests
gremlin run --json              # Run generated tests

# Deployment
gremlin deploy local --json     # Start local server
gremlin deploy docker --json    # Deploy with Docker
gremlin deploy status --json    # Check deployment status
gremlin deploy stop --json      # Stop deployments

# Instrumentation
gremlin instrument --json       # Get instrumentation guidance
\`\`\`

## Agent Workflow
1. Check status: \`gremlin status --json\`
2. Deploy server: \`gremlin deploy local --background --json\`
3. Instrument app entry point with SDK (see below)
4. User interacts with app → sessions recorded
5. View analytics: \`gremlin analytics summary --json\`
6. Get AI insights: \`gremlin analyze --json\`
7. Generate tests: \`gremlin generate --json\`
8. Run tests: \`gremlin run --json\`

## SDK Initialization
The recorder must be initialized ONCE at the app root, not inside components.
${serverUrl ? `This project is configured to send recordings to: ${serverUrl}` : 'By default, the SDK connects to localhost:3334 (gremlin dev server).'}

## data-testid Conventions
- Buttons: data-testid="btn-{action}"
- Navigation: data-testid="nav-{destination}"
- Form inputs: data-testid="input-{field-name}"
- Modals: data-testid="modal-{name}"
- Lists: data-testid="list-{name}"

## Verification
After any change, run \`gremlin status --json\` to confirm state.
Always check \`ok: true\` in JSON output before proceeding.
`;
}
