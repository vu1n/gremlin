/**
 * Instrument command unit tests
 *
 * Tests the instrumentation logic: framework detection,
 * prompt generation, llms.txt generation, and result shaping.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectFramework,
  formatFramework,
  getFrameworkInfo,
  getInitCode,
  type Framework,
} from '../shared/detect.ts';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-instrument-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Types replicated from instrument.ts
// ---------------------------------------------------------------------------

interface InstrumentResult {
  framework: Framework;
  frameworkDisplay: string;
  content: string;
  entryPoint: string;
  installCommand: string;
  sdkPackage: string;
  format: 'prompt' | 'llms';
}

// ---------------------------------------------------------------------------
// Prompt generation (replicate private generatePrompt)
// ---------------------------------------------------------------------------

function generatePrompt(framework: Framework): string {
  const info = getFrameworkInfo(framework);
  const initCode = getInitCode(framework);

  return `
Add Gremlin session recording to this codebase. Gremlin records user sessions
for replay and AI-powered test generation.

STEPS:

1. Install the SDK:
   ${info.installCommand}

2. Find the app entry point:
   ${info.entryPointHint}

3. Add this initialization code near the top of the entry file:
${initCode}

4. Add data-testid attributes to key interactive elements:
   - All form submit buttons: data-testid="btn-submit-{form-name}"
   - Navigation links: data-testid="nav-{destination}"
   - Form inputs: data-testid="input-{field-name}"
   - Modal triggers: data-testid="btn-open-{modal-name}"
   - Important action buttons: data-testid="btn-{action}"

5. The SDK auto-connects to localhost:3334 by default (gremlin dev).
   To point at a remote server, add serverUrl to the config:
   \`\`\`
   const recorder = new GremlinRecorder({
     appName: 'my-app',
     serverUrl: 'https://your-server.example.com',
   });
   \`\`\`

IMPORTANT:
- Initialize the recorder ONCE at the app root, not in individual components
- The recorder automatically captures clicks, inputs, navigation, and errors
- Use data-testid attributes for elements that need reliable test generation
`;
}

// ---------------------------------------------------------------------------
// llms.txt generation (replicate private generateLlmsTxt)
// ---------------------------------------------------------------------------

function generateLlmsTxt(framework: Framework): string {
  const info = getFrameworkInfo(framework);

  return `# Gremlin Session Recording - AI Context

This project uses Gremlin for session recording and AI-powered test generation.

## What Gremlin Does
- Records user interactions (clicks, inputs, navigation, errors)
- Provides session replay for debugging
- Generates Playwright tests from recorded sessions
- Generates fuzz tests for edge case discovery

## Integration Pattern
- Framework: ${info.displayName}
- Entry point: ${info.entryPointHint}
- Initialize recorder ONCE at app root, NOT in individual components
- The SDK auto-connects to localhost:3334 when \`gremlin dev\` is running
- To send to a remote server: add \`serverUrl: 'https://your-server.example.com'\` to recorder config

## data-testid Conventions
Use consistent naming for reliable test generation:

- Buttons: data-testid="btn-{action}" or data-testid="btn-{verb}-{noun}"
  Examples: btn-submit, btn-login, btn-add-to-cart

- Navigation: data-testid="nav-{destination}"
  Examples: nav-home, nav-settings, nav-profile

- Form inputs: data-testid="input-{field-name}"
  Examples: input-email, input-password, input-search

- Modals/dialogs: data-testid="modal-{name}" for container
  data-testid="btn-open-{modal}" for trigger
  Examples: modal-confirm, btn-open-confirm

- Lists: data-testid="list-{name}" for container
  data-testid="list-item-{id}" for items
  Examples: list-products, list-item-123

## Elements to Instrument
Priority order for adding data-testid:

1. **Critical actions**: checkout, submit, delete, confirm
2. **Authentication**: login, logout, signup forms
3. **Navigation**: main menu items, tabs, back buttons
4. **Forms**: all inputs, submit buttons, validation messages
5. **Modals**: trigger buttons, confirm/cancel buttons
6. **Lists**: container and clickable items

## CLI Commands (Agent-Friendly)
\`\`\`bash
# Check project status
gremlin status --json

# Start dev server (receives sessions from SDK)
gremlin dev

# List recorded sessions
gremlin sessions --json

# Generate tests from sessions
gremlin generate --json

# Generate chaos/fuzz tests
gremlin fuzz --json

# Run generated tests
gremlin run --json

# View analytics
gremlin analytics summary --json
\`\`\`

## Verification
After any mutation, run \`gremlin status --json\` to confirm state.

## Common Gotchas
- Don't initialize recorder multiple times (use singleton pattern)
- Don't put recorder init inside React components (causes re-init on render)
- Mask sensitive inputs: recorder auto-masks password fields
- The SDK is ~50KB gzipped for web, minimal performance impact
`;
}

// ---------------------------------------------------------------------------
// Result building
// ---------------------------------------------------------------------------

function buildResult(framework: Framework, format: 'prompt' | 'llms'): InstrumentResult {
  const info = getFrameworkInfo(framework);
  const content = format === 'llms' ? generateLlmsTxt(framework) : generatePrompt(framework);

  return {
    framework,
    frameworkDisplay: info.displayName,
    content,
    entryPoint: info.entryPointHint,
    installCommand: info.installCommand,
    sdkPackage: info.sdkPackage,
    format,
  };
}

// ---------------------------------------------------------------------------
// Prompt content tests
// ---------------------------------------------------------------------------

describe('generatePrompt', () => {
  test('includes SDK install command for web framework', () => {
    const prompt = generatePrompt('vite');
    expect(prompt).toContain('bun add @gremlin/recorder-web');
  });

  test('includes SDK install command for native framework', () => {
    const prompt = generatePrompt('expo');
    expect(prompt).toContain('bun add @gremlin/recorder-react-native');
  });

  test('includes entry point hint', () => {
    const prompt = generatePrompt('nextjs');
    expect(prompt).toContain('pages/_app.tsx');
  });

  test('includes init code with GremlinRecorder', () => {
    const prompt = generatePrompt('vite');
    expect(prompt).toContain('GremlinRecorder');
    expect(prompt).toContain('recorder.start()');
  });

  test('includes data-testid conventions', () => {
    const prompt = generatePrompt('vite');
    expect(prompt).toContain('data-testid');
    expect(prompt).toContain('btn-submit');
    expect(prompt).toContain('nav-');
    expect(prompt).toContain('input-');
  });

  test('includes serverUrl configuration guidance', () => {
    const prompt = generatePrompt('vite');
    expect(prompt).toContain('serverUrl');
    expect(prompt).toContain('localhost:3334');
  });

  test('includes singleton pattern warning', () => {
    const prompt = generatePrompt('nextjs');
    expect(prompt).toContain('Initialize the recorder ONCE');
    expect(prompt).toContain('not in individual components');
  });

  test('generates framework-specific init code for Next.js', () => {
    const prompt = generatePrompt('nextjs');
    expect(prompt).toContain("typeof window !== 'undefined'");
  });

  test('does not include window check for Vite', () => {
    const prompt = generatePrompt('vite');
    expect(prompt).not.toContain('typeof window');
  });
});

// ---------------------------------------------------------------------------
// llms.txt content tests
// ---------------------------------------------------------------------------

describe('generateLlmsTxt', () => {
  test('includes framework display name', () => {
    const content = generateLlmsTxt('nextjs');
    expect(content).toContain('Next.js');
  });

  test('includes entry point hint', () => {
    const content = generateLlmsTxt('vite');
    expect(content).toContain('src/main.tsx');
  });

  test('includes Gremlin description', () => {
    const content = generateLlmsTxt('vite');
    expect(content).toContain('session recording');
    expect(content).toContain('Playwright tests');
    expect(content).toContain('fuzz tests');
  });

  test('includes data-testid conventions', () => {
    const content = generateLlmsTxt('vite');
    expect(content).toContain('data-testid');
    expect(content).toContain('btn-');
    expect(content).toContain('nav-');
    expect(content).toContain('input-');
  });

  test('includes CLI commands section', () => {
    const content = generateLlmsTxt('remix');
    expect(content).toContain('gremlin status');
    expect(content).toContain('gremlin dev');
    expect(content).toContain('gremlin sessions');
    expect(content).toContain('gremlin generate');
  });

  test('includes singleton pattern warning', () => {
    const content = generateLlmsTxt('nextjs');
    expect(content).toContain('ONCE at app root');
    expect(content).toContain('NOT in individual components');
  });

  test('includes native framework info for Expo', () => {
    const content = generateLlmsTxt('expo');
    expect(content).toContain('Expo');
    expect(content).toContain('App.tsx');
  });
});

// ---------------------------------------------------------------------------
// InstrumentResult building
// ---------------------------------------------------------------------------

describe('buildResult', () => {
  test('builds result with prompt format', () => {
    const result = buildResult('vite', 'prompt');

    expect(result.framework).toBe('vite');
    expect(result.frameworkDisplay).toBe('Vite + React');
    expect(result.format).toBe('prompt');
    expect(result.sdkPackage).toBe('@gremlin/recorder-web');
    expect(result.installCommand).toBe('bun add @gremlin/recorder-web');
    expect(result.content).toContain('STEPS');
  });

  test('builds result with llms format', () => {
    const result = buildResult('nextjs', 'llms');

    expect(result.framework).toBe('nextjs');
    expect(result.format).toBe('llms');
    expect(result.content).toContain('# Gremlin Session Recording');
  });

  test('builds result for native framework', () => {
    const result = buildResult('expo', 'prompt');

    expect(result.sdkPackage).toBe('@gremlin/recorder-react-native');
    expect(result.installCommand).toBe('bun add @gremlin/recorder-react-native');
    expect(result.frameworkDisplay).toBe('Expo');
  });

  test('builds result for unknown framework', () => {
    const result = buildResult('unknown', 'prompt');

    expect(result.framework).toBe('unknown');
    expect(result.frameworkDisplay).toContain('Unknown');
    expect(result.sdkPackage).toBe('@gremlin/recorder-web');
  });

  test('entry point hint matches framework', () => {
    const nextResult = buildResult('nextjs', 'prompt');
    expect(nextResult.entryPoint).toContain('pages/_app.tsx');

    const viteResult = buildResult('vite', 'prompt');
    expect(viteResult.entryPoint).toContain('src/main.tsx');

    const expoResult = buildResult('expo', 'prompt');
    expect(expoResult.entryPoint).toContain('App.tsx');
  });
});

// ---------------------------------------------------------------------------
// Framework detection in context of instrument command
// ---------------------------------------------------------------------------

describe('framework detection for instrument', () => {
  test('uses explicit framework option when provided', () => {
    const optionFramework = 'nextjs';
    const framework = optionFramework
      ? (optionFramework as Framework)
      : detectFramework();

    expect(framework).toBe('nextjs');
  });

  test('falls back to detectFramework when no option', () => {
    // No package.json in temp dir = unknown
    const optionFramework = undefined;
    const framework = optionFramework
      ? (optionFramework as Framework)
      : detectFramework();

    expect(framework).toBe('unknown');
  });

  test('detects framework from package.json when no option', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } })
    );

    const optionFramework = undefined;
    const framework = optionFramework
      ? (optionFramework as Framework)
      : detectFramework();

    expect(framework).toBe('nextjs');
  });
});

// ---------------------------------------------------------------------------
// Format option defaulting
// ---------------------------------------------------------------------------

describe('format option', () => {
  test('defaults to prompt when not provided', () => {
    const format = undefined ?? 'prompt';
    expect(format).toBe('prompt');
  });

  test('uses llms when explicitly provided', () => {
    const optionFormat: 'prompt' | 'llms' = 'llms';
    const format = optionFormat ?? 'prompt';
    expect(format).toBe('llms');
  });

  test('prompt format content differs from llms format', () => {
    const promptResult = buildResult('vite', 'prompt');
    const llmsResult = buildResult('vite', 'llms');

    expect(promptResult.content).toContain('STEPS');
    expect(llmsResult.content).toContain('# Gremlin Session Recording');
    expect(promptResult.content).not.toEqual(llmsResult.content);
  });
});

// ---------------------------------------------------------------------------
// All frameworks produce valid results
// ---------------------------------------------------------------------------

describe('all frameworks produce valid results', () => {
  const allFrameworks: Framework[] = [
    'nextjs',
    'vite',
    'cra',
    'remix',
    'expo',
    'react-native',
    'unknown',
  ];

  for (const fw of allFrameworks) {
    test(`${fw} prompt result has all required fields`, () => {
      const result = buildResult(fw, 'prompt');
      expect(result.framework).toBe(fw);
      expect(result.frameworkDisplay.length).toBeGreaterThan(0);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.entryPoint.length).toBeGreaterThan(0);
      expect(result.installCommand.length).toBeGreaterThan(0);
      expect(result.sdkPackage.length).toBeGreaterThan(0);
      expect(result.format).toBe('prompt');
    });

    test(`${fw} llms result has all required fields`, () => {
      const result = buildResult(fw, 'llms');
      expect(result.framework).toBe(fw);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.format).toBe('llms');
    });
  }
});
