/**
 * Instrument Command
 *
 * Generates an AI-friendly prompt that developers can paste into their
 * AI coding assistant to automatically instrument their app with Gremlin.
 *
 * The command detects the framework and generates appropriate instructions.
 */

import {
  detectFramework,
  formatFramework,
  getFrameworkInfo,
  getInitCode,
  type Framework,
} from '../detect.ts';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface InstrumentOptions extends OutputOptions {
  /** Force a specific framework detection */
  framework?: string;

  /** Output format: 'prompt' (default) or 'llms' for llms.txt content */
  format?: 'prompt' | 'llms';
}

export interface InstrumentResult {
  framework: Framework;
  frameworkDisplay: string;
  content: string;
  entryPoint: string;
  installCommand: string;
  sdkPackage: string;
  format: 'prompt' | 'llms';
}

// ============================================================================
// Main Command
// ============================================================================

export async function instrument(options: InstrumentOptions): Promise<InstrumentResult> {
  const framework = options.framework
    ? (options.framework as Framework)
    : detectFramework();

  const info = getFrameworkInfo(framework);
  const format = options.format ?? 'prompt';
  const content =
    format === 'llms' ? generateLlmsTxt(framework) : generatePrompt(framework);

  const result: InstrumentResult = {
    framework,
    frameworkDisplay: info.displayName,
    content,
    entryPoint: info.entryPointHint,
    installCommand: info.installCommand,
    sdkPackage: info.sdkPackage,
    format,
  };

  if (output('instrument', result, options)) return result;

  console.log('');
  console.log('Gremlin Instrument');
  console.log('==================');
  console.log('');
  console.log(`Detected framework: ${formatFramework(framework)}`);
  console.log('');

  if (format === 'llms') {
    console.log('Copy the following to .gremlin/llms.txt:');
    console.log('');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
  } else {
    console.log('Copy this prompt into your AI coding assistant:');
    console.log('');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
  }

  console.log('');
  console.log('After instrumentation, run:');
  console.log('  gremlin dev     # Start local dev server');
  console.log('  # Use your app');
  console.log('  gremlin sessions');
  console.log('  gremlin replay latest');
  console.log('');

  return result;
}

// ============================================================================
// Prompt Generation
// ============================================================================

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

// ============================================================================
// llms.txt Generation
// ============================================================================

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
