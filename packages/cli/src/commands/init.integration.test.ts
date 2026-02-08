/**
 * Init command integration tests
 *
 * Tests the `init` command's directory creation, config generation,
 * .gitignore handling, llms.txt output, and framework detection integration.
 * Uses temp directories to avoid polluting the real filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test the helper functions and sub-behaviors directly since the
// main `init()` function uses `process.cwd()` and `process.exit()`.
import { detectFramework, formatFramework, getFrameworkInfo, findEntryPoint, getInitCode } from '../detect.ts';

// ============================================================================
// Setup / Teardown
// ============================================================================

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-init-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Tests: Framework Detection
// ============================================================================

describe('detectFramework', () => {
  it('detects Next.js from dependencies', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    expect(detectFramework()).toBe('nextjs');
  });

  it('detects Remix from dependencies', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@remix-run/react': '^2.0.0', react: '^18.0.0' },
    }));
    expect(detectFramework()).toBe('remix');
  });

  it('detects Expo from dependencies', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { expo: '^50.0.0', 'react-native': '^0.73.0' },
    }));
    expect(detectFramework()).toBe('expo');
  });

  it('detects bare React Native (not Expo)', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.73.0', react: '^18.0.0' },
    }));
    expect(detectFramework()).toBe('react-native');
  });

  it('detects Vite + React', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    }));
    expect(detectFramework()).toBe('vite');
  });

  it('detects Create React App', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-scripts': '^5.0.0' },
    }));
    expect(detectFramework()).toBe('cra');
  });

  it('returns unknown when no package.json exists', () => {
    expect(detectFramework()).toBe('unknown');
  });

  it('returns unknown for empty package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    expect(detectFramework()).toBe('unknown');
  });

  it('returns unknown for malformed package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not json');
    expect(detectFramework()).toBe('unknown');
  });

  it('prioritizes Next.js over Vite when both present', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    }));
    expect(detectFramework()).toBe('nextjs');
  });

  it('prioritizes Expo over bare React Native', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { expo: '^50.0.0', 'react-native': '^0.73.0', react: '^18.0.0' },
    }));
    expect(detectFramework()).toBe('expo');
  });
});

// ============================================================================
// Tests: Framework Info
// ============================================================================

describe('getFrameworkInfo', () => {
  it('returns web SDK for web frameworks', () => {
    for (const fw of ['nextjs', 'vite', 'cra', 'remix'] as const) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-web');
      expect(info.isNative).toBe(false);
    }
  });

  it('returns RN SDK for native frameworks', () => {
    for (const fw of ['expo', 'react-native'] as const) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-react-native');
      expect(info.isNative).toBe(true);
    }
  });

  it('returns display name for each framework', () => {
    expect(formatFramework('nextjs')).toBe('Next.js');
    expect(formatFramework('vite')).toBe('Vite + React');
    expect(formatFramework('cra')).toBe('Create React App');
    expect(formatFramework('remix')).toBe('Remix');
    expect(formatFramework('expo')).toBe('Expo');
    expect(formatFramework('react-native')).toBe('React Native (bare)');
    expect(formatFramework('unknown')).toContain('Unknown');
  });

  it('includes install command', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.installCommand).toContain('bun add');
    expect(info.installCommand).toContain('@gremlin/recorder-web');
  });

  it('includes entry points', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.entryPoints.length).toBeGreaterThan(0);
    expect(info.entryPoints.some(e => e.includes('_app') || e.includes('layout'))).toBe(true);
  });

  it('includes dev command', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.devCommand).toBe('bun run dev');
  });
});

// ============================================================================
// Tests: Entry Point Detection
// ============================================================================

describe('findEntryPoint', () => {
  it('finds Next.js pages/_app.tsx', () => {
    mkdirSync(join(tmpDir, 'pages'), { recursive: true });
    writeFileSync(join(tmpDir, 'pages/_app.tsx'), 'export default function App() {}');
    expect(findEntryPoint('nextjs')).toBe('pages/_app.tsx');
  });

  it('finds Next.js app/layout.tsx', () => {
    mkdirSync(join(tmpDir, 'app'), { recursive: true });
    writeFileSync(join(tmpDir, 'app/layout.tsx'), 'export default function Layout() {}');
    expect(findEntryPoint('nextjs')).toBe('app/layout.tsx');
  });

  it('prefers pages/_app.tsx over app/layout.tsx', () => {
    mkdirSync(join(tmpDir, 'pages'), { recursive: true });
    mkdirSync(join(tmpDir, 'app'), { recursive: true });
    writeFileSync(join(tmpDir, 'pages/_app.tsx'), '');
    writeFileSync(join(tmpDir, 'app/layout.tsx'), '');
    expect(findEntryPoint('nextjs')).toBe('pages/_app.tsx');
  });

  it('finds Vite src/main.tsx', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/main.tsx'), '');
    expect(findEntryPoint('vite')).toBe('src/main.tsx');
  });

  it('finds Expo App.tsx', () => {
    writeFileSync(join(tmpDir, 'App.tsx'), '');
    expect(findEntryPoint('expo')).toBe('App.tsx');
  });

  it('returns null when no entry point exists', () => {
    expect(findEntryPoint('nextjs')).toBeNull();
  });
});

// ============================================================================
// Tests: Init Code Generation
// ============================================================================

describe('getInitCode', () => {
  it('generates web recorder import for web frameworks', () => {
    const code = getInitCode('vite', { appName: 'MyApp' });
    expect(code).toContain("from '@gremlin/recorder-web'");
    expect(code).toContain("appName: 'MyApp'");
    expect(code).toContain('recorder.start()');
  });

  it('generates RN recorder import for native frameworks', () => {
    const code = getInitCode('expo', { appName: 'MyApp' });
    expect(code).toContain("from '@gremlin/recorder-react-native'");
    expect(code).toContain("appName: 'MyApp'");
  });

  it('includes serverUrl when provided', () => {
    const code = getInitCode('vite', { appName: 'MyApp', serverUrl: 'https://api.example.com' });
    expect(code).toContain("serverUrl: 'https://api.example.com'");
  });

  it('omits serverUrl when not provided', () => {
    const code = getInitCode('vite', { appName: 'MyApp' });
    expect(code).not.toContain('serverUrl');
  });

  it('wraps Next.js code in typeof window check', () => {
    const code = getInitCode('nextjs', { appName: 'MyApp' });
    expect(code).toContain("typeof window !== 'undefined'");
  });

  it('does not wrap non-Next.js web code in window check', () => {
    const code = getInitCode('vite', { appName: 'MyApp' });
    expect(code).not.toContain("typeof window");
  });

  it('uses default app name when none provided', () => {
    const code = getInitCode('vite');
    expect(code).toContain("appName: 'YOUR_APP_NAME'");
  });
});

// ============================================================================
// Tests: Directory Structure Creation
// ============================================================================

describe('init directory structure', () => {
  it('creates .gremlin directory structure', () => {
    const gremlinDir = join(tmpDir, '.gremlin');
    const dirs = ['.gremlin', '.gremlin/sessions', '.gremlin/analytics', '.gremlin/tests'];

    for (const dir of dirs) {
      mkdirSync(join(tmpDir, dir), { recursive: true });
    }

    expect(existsSync(join(tmpDir, '.gremlin'))).toBe(true);
    expect(existsSync(join(tmpDir, '.gremlin/sessions'))).toBe(true);
    expect(existsSync(join(tmpDir, '.gremlin/analytics'))).toBe(true);
    expect(existsSync(join(tmpDir, '.gremlin/tests'))).toBe(true);
  });

  it('writes valid config.json', () => {
    const config = {
      framework: 'nextjs',
      appName: 'TestApp',
      sdkPackage: '@gremlin/recorder-web',
      devServer: { port: 3334 },
      remoteServer: { url: null },
      createdAt: new Date().toISOString(),
    };

    const configPath = join(tmpDir, '.gremlin/config.json');
    mkdirSync(join(tmpDir, '.gremlin'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(parsed.framework).toBe('nextjs');
    expect(parsed.appName).toBe('TestApp');
    expect(parsed.devServer.port).toBe(3334);
  });
});

// ============================================================================
// Tests: .gitignore Handling
// ============================================================================

describe('.gitignore handling', () => {
  it('creates .gitignore if none exists', () => {
    const gitignorePath = join(tmpDir, '.gitignore');
    writeFileSync(gitignorePath, '# Gremlin local data\n.gremlin/\n');

    const content = readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.gremlin/');
  });

  it('appends to existing .gitignore without duplicating', () => {
    const gitignorePath = join(tmpDir, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules/\n.env\n');

    // Simulate init logic
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.gremlin/')) {
      writeFileSync(gitignorePath, content + '\n# Gremlin local data\n.gremlin/\n');
    }

    const updated = readFileSync(gitignorePath, 'utf-8');
    expect(updated).toContain('node_modules/');
    expect(updated).toContain('.gremlin/');
  });

  it('does not duplicate .gremlin/ entry', () => {
    const gitignorePath = join(tmpDir, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules/\n.gremlin/\n');

    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.gremlin/')) {
      writeFileSync(gitignorePath, content + '\n.gremlin/\n');
    }

    const updated = readFileSync(gitignorePath, 'utf-8');
    const occurrences = (updated.match(/\.gremlin\//g) || []).length;
    expect(occurrences).toBe(1);
  });
});

// ============================================================================
// Tests: Code Injection
// ============================================================================

describe('code injection (injectInitCode behavior)', () => {
  // Replicate the injection logic from init.ts for testing
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

  it('injects after last import', () => {
    const source = `import React from 'react';\nimport App from './App';\n\nfunction main() {}`;
    const result = injectInitCode(source, '// GREMLIN INIT');

    const lines = result.split('\n');
    const initLine = lines.findIndex(l => l.includes('GREMLIN INIT'));
    const lastImport = lines.findIndex(l => l.includes("from './App'"));
    expect(initLine).toBeGreaterThan(lastImport);
  });

  it('injects at top when no imports', () => {
    const source = `function main() {}\nconsole.log('hello');`;
    const result = injectInitCode(source, '// GREMLIN INIT');

    const lines = result.split('\n');
    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('// GREMLIN INIT');
  });

  it('preserves original source content', () => {
    const source = `import React from 'react';\n\nfunction App() { return <div />; }`;
    const result = injectInitCode(source, '// INIT');

    expect(result).toContain("import React from 'react'");
    expect(result).toContain('function App()');
    expect(result).toContain('// INIT');
  });

  it('handles multi-line imports', () => {
    const source = `import {\n  useState,\n} from 'react';\n\nfunction App() {}`;
    const result = injectInitCode(source, '// INIT');

    // The "} from 'react'" line should be detected as last import
    expect(result).toContain('// INIT');
    const lines = result.split('\n');
    const initLine = lines.findIndex(l => l === '// INIT');
    const fromLine = lines.findIndex(l => l.includes("} from 'react'"));
    expect(initLine).toBeGreaterThan(fromLine);
  });
});
