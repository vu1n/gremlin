#!/usr/bin/env bun
import { Command } from 'commander';
import { dev } from './commands/dev.ts';
import { generate } from './commands/generate.ts';
import { fuzz } from './commands/fuzz.ts';
import { instrument } from './commands/instrument.ts';
import { replay } from './commands/replay.ts';

const program = new Command();

program
  .name('gremlin')
  .description('AI-powered test generation from real user sessions')
  .version('0.0.1');

program
  .command('init')
  .description('Initialize Gremlin in current project')
  .action(() => {
    console.log('Initializing Gremlin...');
    // TODO: Create .gremlin/ directory, config file
  });

program
  .command('dev')
  .description('Start local dev server to receive sessions from SDK')
  .option('-p, --port <number>', 'Port for dev server', '3334')
  .option('-o, --output <path>', 'Output directory for sessions', '.gremlin/sessions')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => {
    await dev({
      port: parseInt(options.port, 10),
      output: options.output,
      verbose: options.verbose ?? false,
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
  .option('--posthog', 'Import from PostHog')
  .option('--file <path>', 'Import from file')
  .action((options) => {
    console.log('📥 Importing sessions...', options);
    // TODO: Import sessions
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
  .action(async (options) => {
    await generate({
      input: options.input,
      output: options.output,
      spec: options.spec,
      playwright: options.playwright,
      maestro: options.maestro,
      baseUrl: options.baseUrl,
      appId: options.appId,
      provider: options.provider,
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
    await fuzz({
      spec: options.spec,
      output: options.output,
      strategy: options.strategy,
      count: parseInt(options.count, 10),
      seed: options.seed ? parseInt(options.seed, 10) : undefined,
    });
  });

program
  .command('instrument')
  .description('Generate AI-friendly prompt for instrumenting your app')
  .option('--framework <name>', 'Force framework (nextjs, vite, cra, remix, expo, react-native)')
  .option('--llms', 'Output llms.txt format instead of prompt')
  .action(async (options) => {
    await instrument({
      framework: options.framework,
      format: options.llms ? 'llms' : 'prompt',
    });
  });

program
  .command('run')
  .description('Run generated tests')
  .argument('[test]', 'Specific test to run')
  .option('--all', 'Run all tests')
  .action((test, options) => {
    console.log('Running tests...', test, options);
    // TODO: Run tests via Playwright/Maestro
  });

program
  .command('verify')
  .description('Verify a property against the state model')
  .argument('<property>', 'Property to verify (natural language)')
  .action((property) => {
    console.log('✅ Verifying property:', property);
    // TODO: TLA+ verification
  });

program.parse();
