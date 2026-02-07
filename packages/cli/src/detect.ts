/**
 * Framework detection utilities
 *
 * Shared module used by both `init` and `instrument` commands.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export type Framework =
  | 'nextjs'
  | 'vite'
  | 'cra'
  | 'remix'
  | 'expo'
  | 'react-native'
  | 'unknown';

export interface FrameworkInfo {
  framework: Framework;
  displayName: string;
  sdkPackage: string;
  installCommand: string;
  entryPoints: string[];
  entryPointHint: string;
  isNative: boolean;
}

// ============================================================================
// Detection
// ============================================================================

export function detectFramework(): Framework {
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

export function formatFramework(framework: Framework): string {
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

export function getFrameworkInfo(framework: Framework): FrameworkInfo {
  const isNative = framework === 'expo' || framework === 'react-native';
  const sdkPackage = isNative
    ? '@gremlin/recorder-react-native'
    : '@gremlin/recorder-web';

  const entryPoints = getEntryPoints(framework);
  const entryPointHint = getEntryPointHint(framework);

  return {
    framework,
    displayName: formatFramework(framework),
    sdkPackage,
    installCommand: `bun add ${sdkPackage}`,
    entryPoints,
    entryPointHint,
    isNative,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getEntryPoints(framework: Framework): string[] {
  switch (framework) {
    case 'nextjs':
      return [
        'pages/_app.tsx',
        'pages/_app.jsx',
        'app/layout.tsx',
        'app/layout.jsx',
        'src/pages/_app.tsx',
        'src/app/layout.tsx',
      ];
    case 'vite':
      return ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js'];
    case 'cra':
      return ['src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js'];
    case 'remix':
      return ['app/root.tsx', 'app/root.jsx'];
    case 'expo':
      return ['App.tsx', 'App.jsx', 'app/_layout.tsx', 'app/_layout.jsx', 'src/App.tsx'];
    case 'react-native':
      return ['App.tsx', 'App.jsx', 'index.js', 'index.ts'];
    default:
      return ['src/main.tsx', 'src/index.tsx', 'App.tsx', 'index.js'];
  }
}

function getEntryPointHint(framework: Framework): string {
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

/**
 * Find the first existing entry point file for the given framework.
 */
export function findEntryPoint(framework: Framework): string | null {
  const candidates = getEntryPoints(framework);
  for (const candidate of candidates) {
    const fullPath = join(process.cwd(), candidate);
    if (existsSync(fullPath)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Options for generated init code.
 */
export interface InitCodeOptions {
  appName?: string;
  serverUrl?: string;
}

/**
 * Get initialization code for the given framework.
 */
export function getInitCode(framework: Framework, options?: InitCodeOptions): string {
  const appName = options?.appName ?? 'YOUR_APP_NAME';
  const serverUrl = options?.serverUrl;

  const configLines = [`  appName: '${appName}',`];
  if (serverUrl) {
    configLines.push(`  serverUrl: '${serverUrl}',`);
  }
  const config = configLines.join('\n');

  if (framework === 'expo' || framework === 'react-native') {
    return `import { GremlinRecorder } from '@gremlin/recorder-react-native';

const recorder = new GremlinRecorder({
${config}
});

recorder.start();`;
  }

  if (framework === 'nextjs') {
    return `import { GremlinRecorder } from '@gremlin/recorder-web';

if (typeof window !== 'undefined') {
  const recorder = new GremlinRecorder({
${config}
  });
  recorder.start();
}`;
  }

  return `import { GremlinRecorder } from '@gremlin/recorder-web';

const recorder = new GremlinRecorder({
${config}
});
recorder.start();`;
}
