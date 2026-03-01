import { describe, test, expect } from 'bun:test';
import {
  formatFramework,
  getFrameworkInfo,
  getInitCode,
  type Framework,
} from '../../commands/shared/detect.ts';

// ---------------------------------------------------------------------------
// formatFramework
// ---------------------------------------------------------------------------

describe('formatFramework', () => {
  test('returns human-readable names for all known frameworks', () => {
    expect(formatFramework('nextjs')).toBe('Next.js');
    expect(formatFramework('vite')).toBe('Vite + React');
    expect(formatFramework('cra')).toBe('Create React App');
    expect(formatFramework('remix')).toBe('Remix');
    expect(formatFramework('expo')).toBe('Expo');
    expect(formatFramework('react-native')).toBe('React Native (bare)');
  });

  test('returns fallback for unknown framework', () => {
    expect(formatFramework('unknown')).toBe('Unknown (using generic instructions)');
  });
});

// ---------------------------------------------------------------------------
// getFrameworkInfo
// ---------------------------------------------------------------------------

describe('getFrameworkInfo', () => {
  test('returns web SDK for web frameworks', () => {
    for (const fw of ['nextjs', 'vite', 'cra', 'remix'] as Framework[]) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-web');
      expect(info.isNative).toBe(false);
    }
  });

  test('returns native SDK for native frameworks', () => {
    for (const fw of ['expo', 'react-native'] as Framework[]) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-react-native');
      expect(info.isNative).toBe(true);
    }
  });

  test('returns correct display name', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.displayName).toBe('Next.js');
  });

  test('returns install command with SDK package', () => {
    const info = getFrameworkInfo('vite');
    expect(info.installCommand).toBe('bun add @gremlin/recorder-web');
  });

  test('returns entry points as non-empty array', () => {
    const allFrameworks: Framework[] = ['nextjs', 'vite', 'cra', 'remix', 'expo', 'react-native', 'unknown'];
    for (const fw of allFrameworks) {
      const info = getFrameworkInfo(fw);
      expect(info.entryPoints.length).toBeGreaterThan(0);
    }
  });

  test('returns non-empty entry point hint', () => {
    const info = getFrameworkInfo('nextjs');
    expect(info.entryPointHint.length).toBeGreaterThan(0);
  });

  test('returns non-empty dev command', () => {
    const allFrameworks: Framework[] = ['nextjs', 'vite', 'cra', 'remix', 'expo', 'react-native', 'unknown'];
    for (const fw of allFrameworks) {
      const info = getFrameworkInfo(fw);
      expect(info.devCommand.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getInitCode
// ---------------------------------------------------------------------------

describe('getInitCode', () => {
  test('generates web recorder init code by default', () => {
    const code = getInitCode('vite');
    expect(code).toContain("@gremlin/recorder-web");
    expect(code).toContain("GremlinRecorder");
    expect(code).toContain("YOUR_APP_NAME");
    expect(code).toContain("recorder.start()");
  });

  test('generates native recorder init code for expo', () => {
    const code = getInitCode('expo');
    expect(code).toContain("@gremlin/recorder-react-native");
    expect(code).toContain("GremlinRecorder");
    expect(code).toContain("recorder.start()");
  });

  test('generates native recorder init code for react-native', () => {
    const code = getInitCode('react-native');
    expect(code).toContain("@gremlin/recorder-react-native");
  });

  test('generates nextjs-specific code with window check', () => {
    const code = getInitCode('nextjs');
    expect(code).toContain("typeof window !== 'undefined'");
    expect(code).toContain("@gremlin/recorder-web");
  });

  test('uses provided appName', () => {
    const code = getInitCode('vite', { appName: 'MyApp' });
    expect(code).toContain("'MyApp'");
    expect(code).not.toContain("YOUR_APP_NAME");
  });

  test('includes serverUrl when provided', () => {
    const code = getInitCode('vite', { serverUrl: 'http://localhost:4000' });
    expect(code).toContain("serverUrl: 'http://localhost:4000'");
  });

  test('omits serverUrl when not provided', () => {
    const code = getInitCode('vite');
    expect(code).not.toContain('serverUrl');
  });
});
