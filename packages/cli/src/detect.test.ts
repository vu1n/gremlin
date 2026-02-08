import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectFramework,
  formatFramework,
  getFrameworkInfo,
  findEntryPoint,
  getInitCode,
  type Framework,
} from './detect';

// ============================================================================
// detectFramework — uses process.cwd() + package.json
// ============================================================================

describe('detectFramework', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'gremlin-detect-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writePackageJson(deps: Record<string, string>, devDeps?: Record<string, string>) {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: deps,
        devDependencies: devDeps ?? {},
      })
    );
    process.chdir(tempDir);
  }

  it('detects Next.js', () => {
    writePackageJson({ next: '14.0.0', react: '18.0.0' });
    expect(detectFramework()).toBe('nextjs');
  });

  it('detects Remix', () => {
    writePackageJson({ '@remix-run/react': '2.0.0', react: '18.0.0' });
    expect(detectFramework()).toBe('remix');
  });

  it('detects Expo', () => {
    writePackageJson({ expo: '50.0.0', 'react-native': '0.73.0', react: '18.0.0' });
    expect(detectFramework()).toBe('expo');
  });

  it('detects bare React Native (no expo)', () => {
    writePackageJson({ 'react-native': '0.73.0', react: '18.0.0' });
    expect(detectFramework()).toBe('react-native');
  });

  it('detects Vite + React', () => {
    writePackageJson({ vite: '5.0.0', react: '18.0.0' });
    expect(detectFramework()).toBe('vite');
  });

  it('detects Create React App', () => {
    writePackageJson({ 'react-scripts': '5.0.0', react: '18.0.0' });
    expect(detectFramework()).toBe('cra');
  });

  it('returns unknown when no framework deps match', () => {
    writePackageJson({ express: '4.0.0' });
    expect(detectFramework()).toBe('unknown');
  });

  it('returns unknown when no package.json exists', () => {
    process.chdir(tempDir);
    expect(detectFramework()).toBe('unknown');
  });

  it('returns unknown when package.json is invalid JSON', () => {
    writeFileSync(join(tempDir, 'package.json'), '{ not valid json }}}');
    process.chdir(tempDir);
    expect(detectFramework()).toBe('unknown');
  });

  // Priority tests
  it('prefers Next.js over Vite when both present', () => {
    writePackageJson({ next: '14.0.0', vite: '5.0.0', react: '18.0.0' });
    expect(detectFramework()).toBe('nextjs');
  });

  it('prefers Remix over Vite when both present', () => {
    writePackageJson({ '@remix-run/react': '2.0.0', vite: '5.0.0', react: '18.0.0' });
    expect(detectFramework()).toBe('remix');
  });

  it('prefers Expo over bare react-native', () => {
    writePackageJson({ expo: '50.0.0', 'react-native': '0.73.0' });
    expect(detectFramework()).toBe('expo');
  });

  it('detects framework from devDependencies too', () => {
    writePackageJson({}, { next: '14.0.0' });
    expect(detectFramework()).toBe('nextjs');
  });

  it('handles package.json with no dependencies field', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    process.chdir(tempDir);
    expect(detectFramework()).toBe('unknown');
  });
});

// ============================================================================
// formatFramework
// ============================================================================

describe('formatFramework', () => {
  it('formats nextjs', () => expect(formatFramework('nextjs')).toBe('Next.js'));
  it('formats vite', () => expect(formatFramework('vite')).toBe('Vite + React'));
  it('formats cra', () => expect(formatFramework('cra')).toBe('Create React App'));
  it('formats remix', () => expect(formatFramework('remix')).toBe('Remix'));
  it('formats expo', () => expect(formatFramework('expo')).toBe('Expo'));
  it('formats react-native', () => expect(formatFramework('react-native')).toBe('React Native (bare)'));
  it('formats unknown', () => expect(formatFramework('unknown')).toContain('Unknown'));
});

// ============================================================================
// getFrameworkInfo
// ============================================================================

describe('getFrameworkInfo', () => {
  it('returns web SDK for web frameworks', () => {
    for (const fw of ['nextjs', 'vite', 'cra', 'remix'] as Framework[]) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-web');
      expect(info.isNative).toBe(false);
    }
  });

  it('returns RN SDK for native frameworks', () => {
    for (const fw of ['expo', 'react-native'] as Framework[]) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-react-native');
      expect(info.isNative).toBe(true);
    }
  });

  it('includes display name matching formatFramework', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.displayName).toBe('Next.js');
  });

  it('includes install command with SDK package', () => {
    const info = getFrameworkInfo('vite');
    expect(info.installCommand).toBe('bun add @gremlin/recorder-web');
  });

  it('includes entry points for Next.js', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.entryPoints).toContain('pages/_app.tsx');
    expect(info.entryPoints).toContain('app/layout.tsx');
  });

  it('includes entry points for Vite', () => {
    const info = getFrameworkInfo('vite');
    expect(info.entryPoints).toContain('src/main.tsx');
  });

  it('includes entry points for Expo', () => {
    const info = getFrameworkInfo('expo');
    expect(info.entryPoints).toContain('App.tsx');
    expect(info.entryPoints).toContain('app/_layout.tsx');
  });

  it('has non-empty entryPointHint for all frameworks', () => {
    const frameworks: Framework[] = ['nextjs', 'vite', 'cra', 'remix', 'expo', 'react-native', 'unknown'];
    for (const fw of frameworks) {
      const info = getFrameworkInfo(fw);
      expect(info.entryPointHint.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// findEntryPoint
// ============================================================================

describe('findEntryPoint', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'gremlin-entry-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds pages/_app.tsx for Next.js', () => {
    mkdirSync(join(tempDir, 'pages'), { recursive: true });
    writeFileSync(join(tempDir, 'pages/_app.tsx'), '');
    process.chdir(tempDir);

    expect(findEntryPoint('nextjs')).toBe('pages/_app.tsx');
  });

  it('finds src/main.tsx for Vite', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src/main.tsx'), '');
    process.chdir(tempDir);

    expect(findEntryPoint('vite')).toBe('src/main.tsx');
  });

  it('finds App.tsx for Expo', () => {
    writeFileSync(join(tempDir, 'App.tsx'), '');
    process.chdir(tempDir);

    expect(findEntryPoint('expo')).toBe('App.tsx');
  });

  it('returns null when no entry point file exists', () => {
    process.chdir(tempDir);
    expect(findEntryPoint('nextjs')).toBeNull();
  });

  it('returns first match when multiple entry points exist', () => {
    mkdirSync(join(tempDir, 'pages'), { recursive: true });
    mkdirSync(join(tempDir, 'app'), { recursive: true });
    writeFileSync(join(tempDir, 'pages/_app.tsx'), '');
    writeFileSync(join(tempDir, 'app/layout.tsx'), '');
    process.chdir(tempDir);

    // pages/_app.tsx comes before app/layout.tsx in the entry points list
    expect(findEntryPoint('nextjs')).toBe('pages/_app.tsx');
  });
});

// ============================================================================
// getInitCode
// ============================================================================

describe('getInitCode', () => {
  it('uses web recorder for web frameworks', () => {
    const code = getInitCode('vite', { appName: 'my-app' });
    expect(code).toContain("@gremlin/recorder-web");
    expect(code).toContain("GremlinRecorder");
    expect(code).toContain("appName: 'my-app'");
    expect(code).toContain('recorder.start()');
  });

  it('uses RN recorder for native frameworks', () => {
    const code = getInitCode('expo', { appName: 'my-app' });
    expect(code).toContain("@gremlin/recorder-react-native");
    expect(code).toContain("appName: 'my-app'");
  });

  it('wraps in typeof window check for Next.js', () => {
    const code = getInitCode('nextjs');
    expect(code).toContain("typeof window !== 'undefined'");
  });

  it('does not wrap in typeof window check for Vite', () => {
    const code = getInitCode('vite');
    expect(code).not.toContain("typeof window");
  });

  it('includes serverUrl when provided', () => {
    const code = getInitCode('vite', { appName: 'app', serverUrl: 'https://gremlin.example.com' });
    expect(code).toContain("serverUrl: 'https://gremlin.example.com'");
  });

  it('omits serverUrl when not provided', () => {
    const code = getInitCode('vite', { appName: 'app' });
    expect(code).not.toContain('serverUrl');
  });

  it('uses placeholder app name when not provided', () => {
    const code = getInitCode('vite');
    expect(code).toContain('YOUR_APP_NAME');
  });

  it('react-native uses RN recorder import', () => {
    const code = getInitCode('react-native');
    expect(code).toContain("@gremlin/recorder-react-native");
  });
});
