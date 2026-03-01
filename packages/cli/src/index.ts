#!/usr/bin/env bun
import { Command } from 'commander';

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

program
  .command('init')
  .description('Initialize Gremlin in current project')
  .option('--app-name <name>', 'App name for recorder config')
  .option('--framework <name>', 'Force framework (nextjs, vite, cra, remix, expo, react-native)')
  .option('--skip-install', 'Skip SDK package installation')
  .option('--no-instrument', 'Skip auto-instrumentation of entry point')
  .option('--server-url <url>', 'Configure remote server URL')
  .option('--force', 'Reinitialize even if .gremlin/ exists')
  .action(async (options) => {
    const json = program.opts().json;
    const { init } = await import('./commands/init.ts');
    await init({
      appName: options.appName,
      framework: options.framework,
      skipInstall: options.skipInstall,
      instrument: options.instrument !== false, // Default to true
      serverUrl: options.serverUrl,
      force: options.force,
      json,
    });
  });

program
  .command('status')
  .description('Show project status and configuration')
  .action(async () => {
    const json = program.opts().json;
    const { status } = await import('./commands/status.ts');
    await status({ json });
  });

program
  .command('dev')
  .description('Start local dev server to receive sessions from SDK')
  .option('-p, --port <number>', 'Port for dev server', '3334')
  .option('-o, --output <path>', 'Output directory for sessions', '.gremlin/sessions')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => {
    const json = program.opts().json;
    const { dev } = await import('./commands/dev.ts');
    await dev({
      port: parseInt(options.port, 10),
      output: options.output,
      verbose: options.verbose ?? false,
      json,
    });
  });

program
  .command('replay')
  .description('Replay a recorded session')
  .argument('<session>', 'Path to session file')
  .option('-p, --port <number>', 'Port for replay server', '3333')
  .option('--speed <number>', 'Playback speed', '1')
  .option('--no-autoplay', 'Disable auto-play')
  .action(async (session, options) => {
    const { replay } = await import('./commands/replay.ts');
    await replay({
      session,
      port: parseInt(options.port, 10),
      speed: parseFloat(options.speed),
      autoPlay: options.autoplay !== false,
    });
  });

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
      const { importFromPostHog } = await import('./commands/import.ts');
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
      const { importFromFile } = await import('./commands/import.ts');
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

program
  .command('sessions')
  .description('List recorded sessions')
  .option('-i, --input <path>', 'Input sessions directory', '.gremlin/sessions')
  .option('-l, --limit <number>', 'Max sessions to list', '20')
  .option('--sort <metric>', 'Sort by: lcp, cls, inp, fcp, ttfb, fps, longTasks, memory, duration (default: time)')
  .option('--lcp-gt <ms>', 'Filter sessions where LCP exceeds threshold (ms)')
  .option('--cls-gt <value>', 'Filter sessions where CLS exceeds threshold')
  .option('--fps-lt <number>', 'Filter sessions where avgFps is below threshold')
  .option('--slow', 'Sessions failing Core Web Vitals (LCP>2500 OR CLS>0.25 OR INP>200)')
  .action(async (options) => {
    const json = program.opts().json;
    const { listSessions } = await import('./commands/sessions.ts');
    await listSessions({
      input: options.input,
      limit: parseInt(options.limit, 10),
      sort: options.sort,
      lcpGt: options.lcpGt ? parseFloat(options.lcpGt) : undefined,
      clsGt: options.clsGt ? parseFloat(options.clsGt) : undefined,
      fpsLt: options.fpsLt ? parseFloat(options.fpsLt) : undefined,
      slow: options.slow,
      json,
    });
  });

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
  .option('--perf', 'Generate performance regression tests from baseline')
  .option('--errors', 'Generate error regression tests from session error patterns')
  .option('--min-occurrences <n>', 'Minimum error occurrences to generate tests (default: 1)')
  .action(async (options) => {
    const json = program.opts().json;
    const { generate } = await import('./commands/generate/index.ts');
    await generate({
      input: options.input,
      output: options.output,
      spec: options.spec,
      playwright: options.playwright,
      maestro: options.maestro,
      perf: options.perf,
      errors: options.errors,
      minOccurrences: options.minOccurrences ? parseInt(options.minOccurrences, 10) : undefined,
      baseUrl: options.baseUrl,
      appId: options.appId,
      provider: options.provider,
      json,
    });
  });

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
    const { fuzz } = await import('./commands/fuzz.ts');
    await fuzz({
      spec: options.spec,
      output: options.output,
      strategy: options.strategy,
      count: parseInt(options.count, 10),
      seed: options.seed ? parseInt(options.seed, 10) : undefined,
      json,
    });
  });

program
  .command('instrument')
  .description('Generate AI-friendly prompt for instrumenting your app')
  .option('--framework <name>', 'Force framework (nextjs, vite, cra, remix, expo, react-native)')
  .option('--llms', 'Output llms.txt format instead of prompt')
  .action(async (options) => {
    const json = program.opts().json;
    const { instrument } = await import('./commands/instrument.ts');
    await instrument({
      framework: options.framework,
      format: options.llms ? 'llms' : 'prompt',
      json,
    });
  });

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
  .option('--perf', 'Run performance regression tests and compare against baseline')
  .action(async (test, options) => {
    const json = program.opts().json;
    if (options.perf) {
      const { runPerf } = await import('./commands/run.ts');
      await runPerf({ json, verbose: options.verbose, headed: options.headed });
    } else {
      const { run } = await import('./commands/run.ts');
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
    }
  });

const analyticsCmd = program
  .command('analytics')
  .description('Query session analytics');

analyticsCmd
  .command('summary')
  .description('Aggregate analytics summary')
  .option('--since <date>', 'Filter by date (ISO)')
  .action(async (options) => {
    const json = program.opts().json;
    const { analyticsSummary } = await import('./commands/analytics.ts');
    await analyticsSummary({
      since: options.since,
      json,
    });
  });

analyticsCmd
  .command('errors')
  .description('Error breakdown across sessions')
  .option('--since <date>', 'Filter by date (ISO)')
  .action(async (options) => {
    const json = program.opts().json;
    const { analyticsErrors } = await import('./commands/analytics.ts');
    await analyticsErrors({
      since: options.since,
      json,
    });
  });

analyticsCmd
  .command('performance')
  .description('Performance metrics across sessions (Web Vitals, FPS, memory)')
  .option('--app <name>', 'Filter by app name')
  .option('--since <date>', 'Filter by date (ISO)')
  .action(async (options) => {
    const json = program.opts().json;
    const { analyticsPerformance } = await import('./commands/analytics.ts');
    await analyticsPerformance({
      app: options.app,
      since: options.since,
      json,
    });
  });

program
  .command('analyze')
  .description('AI-powered insights from recorded sessions')
  .option('-i, --input <path>', 'Input sessions directory', '.gremlin/sessions')
  .option('--provider <name>', 'AI provider: anthropic, openai, gemini')
  .option('--focus <type>', 'Focus area: ux, errors, performance, all', 'all')
  .action(async (options) => {
    const json = program.opts().json;
    const { analyze } = await import('./commands/analyze.ts');
    await analyze({
      input: options.input,
      provider: options.provider,
      focus: options.focus,
      json,
    });
  });

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
    const { deployLocal } = await import('./commands/deploy.ts');
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
    const { deployDocker } = await import('./commands/deploy.ts');
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
    const { deployStatus } = await import('./commands/deploy.ts');
    await deployStatus({ json });
  });

deployCmd
  .command('stop')
  .description('Stop running deployments')
  .option('--target <type>', 'Target: local, docker, all', 'all')
  .action(async (options) => {
    const json = program.opts().json;
    const { deployStop } = await import('./commands/deploy.ts');
    await deployStop({
      target: options.target,
      json,
    });
  });

program
  .command('perf-baseline')
  .description('Snapshot current performance metrics as a baseline for regression testing')
  .option('-i, --input <path>', 'Sessions directory', '.gremlin/sessions')
  .option('--margin <number>', 'Budget margin multiplier above p75', '1.4')
  .option('--update', 'Update existing baseline (keep tighter budgets)')
  .action(async (options) => {
    const json = program.opts().json;
    const { perfBaseline } = await import('./commands/perf-baseline.ts');
    await perfBaseline({
      input: options.input,
      margin: parseFloat(options.margin),
      update: options.update,
      json,
    });
  });

program
  .command('errors')
  .description('List error patterns across sessions and check test coverage')
  .option('-i, --input <path>', 'Input sessions directory', '.gremlin/sessions')
  .option('--min-occurrences <n>', 'Minimum occurrences to show (default: 1)')
  .option('--since <date>', 'Filter sessions after this ISO date')
  .option('--generate', 'Generate error regression tests (shorthand for generate --errors)')
  .action(async (options) => {
    const json = program.opts().json;
    const { errors } = await import('./commands/errors.ts');
    await errors({
      input: options.input,
      minOccurrences: options.minOccurrences ? parseInt(options.minOccurrences, 10) : undefined,
      since: options.since,
      generate: options.generate,
      json,
    });
  });

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const json = program.opts().json;
  if (json) {
    console.log(JSON.stringify({ ok: false, command: 'unknown', errors: [message] }));
  } else {
    console.error(message);
  }
  process.exit(1);
});
