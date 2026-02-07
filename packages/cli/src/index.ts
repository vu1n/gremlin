#!/usr/bin/env bun
import { Command } from 'commander';
import { dev } from './commands/dev.ts';
import { generate } from './commands/generate.ts';
import { fuzz } from './commands/fuzz.ts';
import { instrument } from './commands/instrument.ts';
import { replay } from './commands/replay.ts';
import { importFromPostHog, importFromFile } from './commands/import.ts';
import { run } from './commands/run.ts';
import { listSessions } from './commands/sessions.ts';
import { init } from './commands/init.ts';
import { status } from './commands/status.ts';
import { analyticsSummary, analyticsErrors } from './commands/analytics.ts';
import { analyze } from './commands/analyze.ts';
import { deployLocal, deployDocker, deployStatus, deployStop } from './commands/deploy.ts';

const program = new Command();

program
  .name('gremlin')
  .description('AI-powered test generation from real user sessions')
  .version('0.0.1')
  .option('--json', 'Machine-readable JSON output');

program.addHelpText(
  'after',
  `
Dev workflow:
  gremlin dev
  gremlin sessions
  gremlin replay latest
  gremlin generate

Agent workflow:
  gremlin init --json
  gremlin status --json
  gremlin dev
  gremlin sessions --json
  gremlin generate --json
  gremlin analytics summary --json
`
);

// ============================================================================
// Init
// ============================================================================

program
  .command('init')
  .description('Initialize Gremlin in current project')
  .option('--app-name <name>', 'App name for recorder config')
  .option('--framework <name>', 'Force framework (nextjs, vite, cra, remix, expo, react-native)')
  .option('--skip-install', 'Skip SDK package installation')
  .option('--instrument', 'Auto-instrument entry point')
  .option('--server-url <url>', 'Configure remote server URL')
  .action(async (options) => {
    const json = program.opts().json;
    await init({
      appName: options.appName,
      framework: options.framework,
      skipInstall: options.skipInstall,
      instrument: options.instrument,
      serverUrl: options.serverUrl,
      json,
    });
  });

// ============================================================================
// Status
// ============================================================================

program
  .command('status')
  .description('Show project status and configuration')
  .action(async () => {
    const json = program.opts().json;
    await status({ json });
  });

// ============================================================================
// Dev
// ============================================================================

program
  .command('dev')
  .description('Start local dev server to receive sessions from SDK')
  .option('-p, --port <number>', 'Port for dev server', '3334')
  .option('-o, --output <path>', 'Output directory for sessions', '.gremlin/sessions')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => {
    const json = program.opts().json;
    await dev({
      port: parseInt(options.port, 10),
      output: options.output,
      verbose: options.verbose ?? false,
      json,
    });
  });

// ============================================================================
// Replay
// ============================================================================

program
  .command('replay')
  .description('Replay a recorded session')
  .argument('<session>', 'Path to session file')
  .option('-p, --port <number>', 'Port for replay server', '3333')
  .option('--speed <number>', 'Playback speed', '1')
  .option('--no-autoplay', 'Disable auto-play')
  .action(async (session, options) => {
    await replay({
      session,
      port: parseInt(options.port, 10),
      speed: parseFloat(options.speed),
      autoPlay: options.autoplay !== false,
    });
  });

// ============================================================================
// Import
// ============================================================================

program
  .command('import')
  .description('Import sessions from external source')
  .option('--posthog', 'Import from PostHog session recordings')
  .option('--file <path>', 'Import from local rrweb JSON file')
  .option('--format <type>', 'File format: rrweb, posthog (auto-detected)')
  .option(
    '--api-key <key>',
    'PostHog API key (or set POSTHOG_API_KEY env var)'
  )
  .option(
    '--project-id <id>',
    'PostHog project ID (or set POSTHOG_PROJECT_ID env var)'
  )
  .option('--host <url>', 'PostHog host URL', 'https://app.posthog.com')
  .option('--recording-id <id>', 'Import a specific recording by ID')
  .option('--limit <number>', 'Max recordings to import', '10')
  .option('--date-from <date>', 'Filter: recordings after this date (ISO)')
  .option('--date-to <date>', 'Filter: recordings before this date (ISO)')
  .option('-o, --output <path>', 'Output directory', '.gremlin/sessions')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => {
    const json = program.opts().json;
    if (options.posthog) {
      await importFromPostHog({
        apiKey: options.apiKey || process.env.POSTHOG_API_KEY || '',
        projectId: options.projectId || process.env.POSTHOG_PROJECT_ID || '',
        host: options.host,
        output: options.output,
        verbose: options.verbose,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        recordingId: options.recordingId,
        json,
      });
    } else if (options.file) {
      await importFromFile({
        file: options.file,
        format: options.format,
        output: options.output,
        verbose: options.verbose,
        json,
      });
    } else {
      console.log('Usage: gremlin import --posthog [options]');
      console.log('       gremlin import --file <path> [options]');
      console.log('\nExamples:');
      console.log(
        '  gremlin import --posthog --api-key=phx_xxx --project-id=12345'
      );
      console.log('  gremlin import --posthog --recording-id=abc123');
      console.log('  gremlin import --file ./recording.json');
      console.log('\nRun "gremlin import --help" for all options');
    }
  });

// ============================================================================
// Sessions
// ============================================================================

program
  .command('sessions')
  .description('List recorded sessions')
  .option('-i, --input <path>', 'Input sessions directory', '.gremlin/sessions')
  .option('-l, --limit <number>', 'Max sessions to list', '20')
  .action(async (options) => {
    const json = program.opts().json;
    await listSessions({
      input: options.input,
      limit: parseInt(options.limit, 10),
      json,
    });
  });

// ============================================================================
// Generate
// ============================================================================

program
  .command('generate')
  .description('Generate tests from recorded sessions')
  .option('-i, --input <path>', 'Input sessions directory', '.gremlin/sessions')
  .option('-o, --output <path>', 'Output tests directory', '.gremlin/tests')
  .option('--spec <path>', 'Use existing GremlinSpec file instead of analyzing sessions')
  .option('--playwright', 'Generate Playwright tests', true)
  .option('--maestro', 'Generate Maestro tests')
  .option('--base-url <url>', 'Base URL for web tests', 'http://localhost:3000')
  .option('--app-id <id>', 'App ID for mobile tests', 'com.example.app')
  .option('--provider <name>', 'AI provider: anthropic, openai, gemini')
  .action(async (options) => {
    const json = program.opts().json;
    await generate({
      input: options.input,
      output: options.output,
      spec: options.spec,
      playwright: options.playwright,
      maestro: options.maestro,
      baseUrl: options.baseUrl,
      appId: options.appId,
      provider: options.provider,
      json,
    });
  });

// ============================================================================
// Fuzz
// ============================================================================

program
  .command('fuzz')
  .description('Generate fuzz tests from state model')
  .option('--spec <path>', 'Path to GremlinSpec file', '.gremlin/tests/spec.json')
  .option('-o, --output <path>', 'Output directory for fuzz tests', '.gremlin/tests/fuzz')
  .option('--strategy <type>', 'Fuzz strategy: random-walk, boundary, chaos, all (comma-separated)', 'all')
  .option('--count <number>', 'Number of tests to generate', '10')
  .option('--seed <number>', 'Random seed for reproducible tests')
  .action(async (options) => {
    const json = program.opts().json;
    await fuzz({
      spec: options.spec,
      output: options.output,
      strategy: options.strategy,
      count: parseInt(options.count, 10),
      seed: options.seed ? parseInt(options.seed, 10) : undefined,
      json,
    });
  });

// ============================================================================
// Instrument
// ============================================================================

program
  .command('instrument')
  .description('Generate AI-friendly prompt for instrumenting your app')
  .option('--framework <name>', 'Force framework (nextjs, vite, cra, remix, expo, react-native)')
  .option('--llms', 'Output llms.txt format instead of prompt')
  .action(async (options) => {
    const json = program.opts().json;
    await instrument({
      framework: options.framework,
      format: options.llms ? 'llms' : 'prompt',
      json,
    });
  });

// ============================================================================
// Run
// ============================================================================

program
  .command('run')
  .description('Run generated tests (Playwright and/or Maestro)')
  .argument('[test]', 'Specific test file or pattern to run')
  .option('--all', 'Run all tests')
  .option('-d, --tests-dir <path>', 'Tests directory', '.gremlin/tests')
  .option('-v, --verbose', 'Verbose logging')
  .option('--headed', 'Run Playwright tests in headed mode')
  .option('--watch', 'Run Playwright in UI/watch mode')
  .option('--update-snapshots', 'Update Playwright snapshots')
  .option('--device <name>', 'Maestro device to run on')
  .action(async (test, options) => {
    const json = program.opts().json;
    await run({
      test,
      all: options.all,
      testsDir: options.testsDir,
      verbose: options.verbose,
      headed: options.headed,
      watch: options.watch,
      updateSnapshots: options.updateSnapshots,
      device: options.device,
      json,
    });
  });

// ============================================================================
// Analytics
// ============================================================================

const analyticsCmd = program
  .command('analytics')
  .description('Query session analytics');

analyticsCmd
  .command('summary')
  .description('Aggregate analytics summary')
  .option('--app <name>', 'Filter by app name')
  .option('--since <date>', 'Filter by date (ISO)')
  .action(async (options) => {
    const json = program.opts().json;
    await analyticsSummary({
      app: options.app,
      since: options.since,
      json,
    });
  });

analyticsCmd
  .command('errors')
  .description('Error breakdown across sessions')
  .option('--app <name>', 'Filter by app name')
  .option('--since <date>', 'Filter by date (ISO)')
  .action(async (options) => {
    const json = program.opts().json;
    await analyticsErrors({
      app: options.app,
      since: options.since,
      json,
    });
  });

// ============================================================================
// Analyze
// ============================================================================

program
  .command('analyze')
  .description('AI-powered insights from recorded sessions')
  .option('-i, --input <path>', 'Input sessions directory', '.gremlin/sessions')
  .option('--provider <name>', 'AI provider: anthropic, openai, gemini')
  .option('--focus <type>', 'Focus area: ux, errors, performance, all', 'all')
  .action(async (options) => {
    const json = program.opts().json;
    await analyze({
      input: options.input,
      provider: options.provider,
      focus: options.focus,
      json,
    });
  });

// ============================================================================
// Deploy
// ============================================================================

const deployCmd = program
  .command('deploy')
  .description('Deploy Gremlin server');

deployCmd
  .command('local')
  .description('Start local dev server')
  .option('-p, --port <number>', 'Port', '3334')
  .option('--background', 'Run as background daemon')
  .action(async (options) => {
    const json = program.opts().json;
    await deployLocal({
      port: parseInt(options.port, 10),
      background: options.background,
      json,
    });
  });

deployCmd
  .command('docker')
  .description('Deploy with Docker')
  .option('-p, --port <number>', 'Port', '8787')
  .option('--api-key <key>', 'Set API key (or auto-generate)')
  .option('--data-dir <path>', 'Host data directory')
  .option('--no-detach', 'Run in foreground')
  .action(async (options) => {
    const json = program.opts().json;
    await deployDocker({
      port: parseInt(options.port, 10),
      apiKey: options.apiKey,
      dataDir: options.dataDir,
      detach: options.detach !== false,
      json,
    });
  });

deployCmd
  .command('status')
  .description('Check deployment status')
  .action(async () => {
    const json = program.opts().json;
    await deployStatus({ json });
  });

deployCmd
  .command('stop')
  .description('Stop running deployments')
  .option('--target <type>', 'Target: local, docker, all', 'all')
  .action(async (options) => {
    const json = program.opts().json;
    await deployStop({
      target: options.target,
      json,
    });
  });

program.parse();
