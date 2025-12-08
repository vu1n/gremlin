/**
 * Instrument Command
 *
 * Generates an AI-friendly prompt that developers can paste into their
 * AI coding assistant to automatically instrument their app with Gremlin.
 *
 * The command detects the framework and generates appropriate instructions.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface InstrumentOptions {
  /** Force a specific framework detection */
  framework?: string;

  /** Output format: 'prompt' (default) or 'llms' for llms.txt content */
  format?: 'prompt' | 'llms';
}

type Framework = 'nextjs' | 'vite' | 'cra' | 'remix' | 'expo' | 'react-native' | 'unknown';

// ============================================================================
// Main Command
// ============================================================================

export async function instrument(options: InstrumentOptions): Promise<void> {
  const framework = options.framework
    ? (options.framework as Framework)
    : detectFramework();

  console.log('');
  console.log('Gremlin Instrument');
  console.log('==================');
  console.log('');
  console.log(`Detected framework: ${formatFramework(framework)}`);
  console.log('');

  if (options.format === 'llms') {
    console.log('Copy the following to .gremlin/llms.txt:');
    console.log('');
    console.log('─'.repeat(60));
    console.log(generateLlmsTxt(framework));
    console.log('─'.repeat(60));
  } else {
    console.log('Copy this prompt into your AI coding assistant:');
    console.log('');
    console.log('─'.repeat(60));
    console.log(generatePrompt(framework));
    console.log('─'.repeat(60));
  }

  console.log('');
  console.log('After instrumentation, run:');
  console.log('  gremlin dev     # Start local dev server');
  console.log('  # Use your app');
  console.log('  gremlin replay latest');
  console.log('');
}

// ============================================================================
// Framework Detection
// ============================================================================

function detectFramework(): Framework {
  const packageJsonPath = join(process.cwd(), 'package.json');

  if (!existsSync(packageJsonPath)) {
    return 'unknown';
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Check for specific frameworks
    if (deps['next']) return 'nextjs';
    if (deps['@remix-run/react']) return 'remix';
    if (deps['expo']) return 'expo';
    if (deps['react-native'] && !deps['expo']) return 'react-native';
    if (deps['vite'] && deps['react']) return 'vite';
    if (deps['react-scripts']) return 'cra';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatFramework(framework: Framework): string {
  switch (framework) {
    case 'nextjs':
      return 'Next.js';
    case 'vite':
      return 'Vite + React';
    case 'cra':
      return 'Create React App';
    case 'remix':
      return 'Remix';
    case 'expo':
      return 'Expo';
    case 'react-native':
      return 'React Native (bare)';
    default:
      return 'Unknown (using generic instructions)';
  }
}

// ============================================================================
// Prompt Generation
// ============================================================================

function generatePrompt(framework: Framework): string {
  const baseInstructions = `
Add Gremlin session recording to this codebase. Gremlin records user sessions
for replay and AI-powered test generation.

STEPS:
`;

  const installCmd = getInstallCommand(framework);
  const entryPoint = getEntryPointInfo(framework);
  const initCode = getInitCode(framework);

  return `${baseInstructions}
1. Install the SDK:
   ${installCmd}

2. Find the app entry point:
   ${entryPoint}

3. Add this initialization code near the top of the entry file:
${initCode}

4. Add data-testid attributes to key interactive elements:
   - All form submit buttons: data-testid="btn-submit-{form-name}"
   - Navigation links: data-testid="nav-{destination}"
   - Form inputs: data-testid="input-{field-name}"
   - Modal triggers: data-testid="btn-open-{modal-name}"
   - Important action buttons: data-testid="btn-{action}"

5. The SDK auto-connects to the local dev server (gremlin dev) on localhost:3334.
   No additional configuration is needed for development.

IMPORTANT:
- Initialize the recorder ONCE at the app root, not in individual components
- The recorder automatically captures clicks, inputs, navigation, and errors
- Use data-testid attributes for elements that need reliable test generation
`;
}

function getInstallCommand(framework: Framework): string {
  const webPackage = 'npm install @gremlin/recorder-web';
  const rnPackage = 'npm install @gremlin/recorder-react-native';

  switch (framework) {
    case 'expo':
    case 'react-native':
      return rnPackage;
    default:
      return webPackage;
  }
}

function getEntryPointInfo(framework: Framework): string {
  switch (framework) {
    case 'nextjs':
      return 'Look for pages/_app.tsx, app/layout.tsx, or src/pages/_app.tsx';
    case 'vite':
      return 'Look for src/main.tsx or src/main.jsx';
    case 'cra':
      return 'Look for src/index.tsx or src/index.jsx';
    case 'remix':
      return 'Look for app/root.tsx';
    case 'expo':
      return 'Look for App.tsx, app/_layout.tsx (if using expo-router), or src/App.tsx';
    case 'react-native':
      return 'Look for App.tsx or index.js';
    default:
      return 'Find the main app entry point where React renders';
  }
}

function getInitCode(framework: Framework): string {
  if (framework === 'expo' || framework === 'react-native') {
    return `
   import { GremlinRecorder } from '@gremlin/recorder-react-native';

   // Initialize recorder (do this once, outside component)
   const recorder = new GremlinRecorder({
     appName: 'YOUR_APP_NAME',
   });

   // Start recording (call this when app mounts)
   recorder.start();

   // Stop recording when needed (e.g., on logout)
   // recorder.stop();
`;
  }

  // Web frameworks
  if (framework === 'nextjs') {
    return `
   // In _app.tsx or layout.tsx:
   import { GremlinRecorder } from '@gremlin/recorder-web';

   // Initialize outside component (runs once)
   if (typeof window !== 'undefined') {
     const recorder = new GremlinRecorder({
       appName: 'YOUR_APP_NAME',
     });
     recorder.start();
   }
`;
  }

  return `
   import { GremlinRecorder } from '@gremlin/recorder-web';

   // Initialize recorder (do this once, at app startup)
   const recorder = new GremlinRecorder({
     appName: 'YOUR_APP_NAME',
   });
   recorder.start();

   // Optional: Stop recording when user logs out
   // recorder.stop();
`;
}

// ============================================================================
// llms.txt Generation
// ============================================================================

function generateLlmsTxt(framework: Framework): string {
  return `# Gremlin Session Recording - AI Context

This project uses Gremlin for session recording and AI-powered test generation.

## What Gremlin Does
- Records user interactions (clicks, inputs, navigation, errors)
- Provides session replay for debugging
- Generates Playwright tests from recorded sessions
- Generates fuzz tests for edge case discovery

## Integration Pattern
- Framework: ${formatFramework(framework)}
- Entry point: ${getEntryPointInfo(framework)}
- Initialize recorder ONCE at app root, NOT in individual components
- The SDK auto-connects to localhost:3334 when \`gremlin dev\` is running

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

## Developer Workflow
\`\`\`bash
# Start dev server (receives sessions from SDK)
gremlin dev

# User interacts with app...

# Watch most recent session
gremlin replay latest

# Generate tests from sessions
gremlin generate

# Generate chaos/fuzz tests
gremlin fuzz
\`\`\`

## Common Gotchas
- Don't initialize recorder multiple times (use singleton pattern)
- Don't put recorder init inside React components (causes re-init on render)
- Mask sensitive inputs: recorder auto-masks password fields
- The SDK is ~50KB gzipped for web, minimal performance impact
`;
}
