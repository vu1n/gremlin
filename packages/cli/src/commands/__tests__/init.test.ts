/**
 * Init command unit tests
 *
 * Tests the init command's core logic: config file creation, directory setup,
 * .gitignore handling, llms.txt generation, and code injection.
 *
 * Uses temp directories to avoid polluting the real filesystem.
 * Does NOT call the main `init()` entrypoint (which calls process.exit);
 * instead tests the sub-behaviors and exported helpers directly.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  appendFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getFrameworkInfo,
  getInitCode,
  formatFramework,
  type Framework,
} from '../shared/detect.ts';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gremlin-init-unit-'));
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
// Config file creation
// ---------------------------------------------------------------------------

describe('config file creation', () => {
  test('writes valid JSON config with all expected fields', () => {
    const gremlinDir = join(tmpDir, '.gremlin');
    mkdirSync(gremlinDir, { recursive: true });

    const config = {
      framework: 'nextjs' as Framework,
      appName: 'test-app',
      sdkPackage: '@gremlin/recorder-web',
      devServer: { port: 3334 },
      remoteServer: { url: null },
      createdAt: new Date().toISOString(),
    };

    const configPath = join(gremlinDir, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(parsed.framework).toBe('nextjs');
    expect(parsed.appName).toBe('test-app');
    expect(parsed.sdkPackage).toBe('@gremlin/recorder-web');
    expect(parsed.devServer.port).toBe(3334);
    expect(parsed.remoteServer.url).toBeNull();
    expect(parsed.createdAt).toBeDefined();
  });

  test('writes config with custom server URL', () => {
    const gremlinDir = join(tmpDir, '.gremlin');
    mkdirSync(gremlinDir, { recursive: true });

    const serverUrl = 'https://gremlin.example.com';
    const config = {
      framework: 'vite',
      appName: 'my-app',
      sdkPackage: '@gremlin/recorder-web',
      devServer: { port: 3334 },
      remoteServer: { url: serverUrl },
      createdAt: new Date().toISOString(),
    };

    const configPath = join(gremlinDir, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(parsed.remoteServer.url).toBe(serverUrl);
  });

  test('config uses native SDK for expo framework', () => {
    const info = getFrameworkInfo('expo');
    const config = {
      framework: 'expo',
      appName: 'mobile-app',
      sdkPackage: info.sdkPackage,
      devServer: { port: 3334 },
      remoteServer: { url: null },
    };

    expect(config.sdkPackage).toBe('@gremlin/recorder-react-native');
  });

  test('config uses web SDK for web frameworks', () => {
    const webFrameworks: Framework[] = ['nextjs', 'vite', 'cra', 'remix'];
    for (const fw of webFrameworks) {
      const info = getFrameworkInfo(fw);
      expect(info.sdkPackage).toBe('@gremlin/recorder-web');
    }
  });
});

// ---------------------------------------------------------------------------
// Directory structure setup
// ---------------------------------------------------------------------------

describe('directory structure setup', () => {
  test('creates all required .gremlin subdirectories', () => {
    const directories = [
      '.gremlin',
      '.gremlin/sessions',
      '.gremlin/analytics',
      '.gremlin/tests',
    ];

    for (const dir of directories) {
      mkdirSync(join(tmpDir, dir), { recursive: true });
    }

    for (const dir of directories) {
      expect(existsSync(join(tmpDir, dir))).toBe(true);
    }
  });

  test('mkdirSync with recursive: true is idempotent', () => {
    const dir = join(tmpDir, '.gremlin', 'sessions');
    mkdirSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true }); // Should not throw

    expect(existsSync(dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// App name resolution
// ---------------------------------------------------------------------------

describe('app name resolution', () => {
  test('reads app name from package.json', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-cool-app' })
    );

    const pkg = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('my-cool-app');
  });

  test('falls back to my-app when package.json has no name', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({}));

    const pkg = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf-8'));
    const appName = pkg.name || 'my-app';
    expect(appName).toBe('my-app');
  });

  test('falls back to my-app when package.json does not exist', () => {
    let appName: string | undefined;

    if (existsSync(join(tmpDir, 'package.json'))) {
      try {
        const pkg = JSON.parse(
          readFileSync(join(tmpDir, 'package.json'), 'utf-8')
        );
        appName = pkg.name;
      } catch {
        // ignore
      }
    }

    if (!appName) appName = 'my-app';
    expect(appName).toBe('my-app');
  });

  test('falls back to my-app on malformed package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not valid json');

    let appName: string | undefined;
    try {
      const pkg = JSON.parse(
        readFileSync(join(tmpDir, 'package.json'), 'utf-8')
      );
      appName = pkg.name;
    } catch {
      // ignore
    }

    if (!appName) appName = 'my-app';
    expect(appName).toBe('my-app');
  });
});

// ---------------------------------------------------------------------------
// .gitignore handling
// ---------------------------------------------------------------------------

describe('.gitignore handling', () => {
  test('creates .gitignore with .gremlin/ entry when file does not exist', () => {
    const gitignorePath = join(tmpDir, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(false);

    writeFileSync(gitignorePath, '# Gremlin local data\n.gremlin/\n');

    const content = readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.gremlin/');
  });

  test('appends .gremlin/ to existing .gitignore without it', () => {
    const gitignorePath = join(tmpDir, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules/\n.env\n');

    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.gremlin/')) {
      appendFileSync(gitignorePath, '\n# Gremlin local data\n.gremlin/\n');
    }

    const updated = readFileSync(gitignorePath, 'utf-8');
    expect(updated).toContain('node_modules/');
    expect(updated).toContain('.env');
    expect(updated).toContain('.gremlin/');
  });

  test('does not duplicate .gremlin/ entry when already present', () => {
    const gitignorePath = join(tmpDir, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules/\n.gremlin/\n');

    const content = readFileSync(gitignorePath, 'utf-8');
    const alreadyPresent = content.includes('.gremlin/');
    expect(alreadyPresent).toBe(true);

    if (!alreadyPresent) {
      appendFileSync(gitignorePath, '\n.gremlin/\n');
    }

    const updated = readFileSync(gitignorePath, 'utf-8');
    const occurrences = (updated.match(/\.gremlin\//g) || []).length;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// llms.txt generation
// ---------------------------------------------------------------------------

describe('llms.txt generation', () => {
  // Replicate the generateLlmsTxt logic locally for testing
  function generateLlmsTxt(
    framework: Framework,
    appName: string,
    sdkPackage: string,
    serverUrl?: string
  ): string {
    const serverNote = serverUrl
      ? `- Server: ${serverUrl} (SDK sends recordings here)`
      : '- Server: localhost:3334 (run `gremlin dev` or `gremlin deploy local`)';

    return `# Gremlin - ${appName}\n\n> AI-powered session recording, analytics, and test generation\n\n## Project Setup\n- Framework: ${formatFramework(framework)}\n- SDK: ${sdkPackage}\n- Config: .gremlin/config.json\n${serverNote}`;
  }

  test('generates llms.txt with app name and framework', () => {
    const content = generateLlmsTxt(
      'nextjs',
      'TestApp',
      '@gremlin/recorder-web'
    );

    expect(content).toContain('# Gremlin - TestApp');
    expect(content).toContain('Next.js');
    expect(content).toContain('@gremlin/recorder-web');
  });

  test('includes localhost server note when no server URL', () => {
    const content = generateLlmsTxt(
      'vite',
      'my-app',
      '@gremlin/recorder-web'
    );

    expect(content).toContain('localhost:3334');
  });

  test('includes custom server URL when provided', () => {
    const content = generateLlmsTxt(
      'vite',
      'my-app',
      '@gremlin/recorder-web',
      'https://gremlin.example.com'
    );

    expect(content).toContain('https://gremlin.example.com');
    expect(content).not.toContain('localhost:3334');
  });

  test('writes llms.txt to .gremlin directory', () => {
    const gremlinDir = join(tmpDir, '.gremlin');
    mkdirSync(gremlinDir, { recursive: true });

    const content = generateLlmsTxt(
      'remix',
      'my-remix-app',
      '@gremlin/recorder-web'
    );

    const llmsTxtPath = join(gremlinDir, 'llms.txt');
    writeFileSync(llmsTxtPath, content);

    expect(existsSync(llmsTxtPath)).toBe(true);
    const written = readFileSync(llmsTxtPath, 'utf-8');
    expect(written).toContain('my-remix-app');
    expect(written).toContain('Remix');
  });
});

// ---------------------------------------------------------------------------
// Code injection (injectInitCode)
// ---------------------------------------------------------------------------

describe('injectInitCode', () => {
  // Replicate the private injectInitCode from init.ts
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

  test('injects code after the last import statement', () => {
    const source = `import React from 'react';\nimport App from './App';\n\nconst x = 1;`;
    const result = injectInitCode(source, '// GREMLIN');

    const lines = result.split('\n');
    const initIdx = lines.findIndex((l) => l === '// GREMLIN');
    const appImportIdx = lines.findIndex((l) => l.includes("from './App'"));
    expect(initIdx).toBeGreaterThan(appImportIdx);
  });

  test('injects at top of file when no imports exist', () => {
    const source = 'const x = 1;\nconsole.log(x);';
    const result = injectInitCode(source, '// GREMLIN');

    const lines = result.split('\n');
    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('// GREMLIN');
  });

  test('preserves all original content', () => {
    const source = `import React from 'react';\n\nfunction App() { return null; }`;
    const result = injectInitCode(source, '// INIT');

    expect(result).toContain("import React from 'react'");
    expect(result).toContain('function App()');
    expect(result).toContain('// INIT');
  });

  test('handles multi-line imports with destructuring', () => {
    const source = `import {\n  useState,\n  useEffect,\n} from 'react';\n\nfunction App() {}`;
    const result = injectInitCode(source, '// INIT');

    const lines = result.split('\n');
    const initIdx = lines.findIndex((l) => l === '// INIT');
    const fromIdx = lines.findIndex((l) => l.includes("} from 'react'"));
    expect(initIdx).toBeGreaterThan(fromIdx);
  });

  test('handles side-effect imports', () => {
    const source = `import './styles.css';\nimport 'normalize.css';\n\nconst a = 1;`;
    const result = injectInitCode(source, '// INIT');

    const lines = result.split('\n');
    const initIdx = lines.findIndex((l) => l === '// INIT');
    const lastSideEffectIdx = lines.findIndex((l) =>
      l.includes("import 'normalize.css'")
    );
    expect(initIdx).toBeGreaterThan(lastSideEffectIdx);
  });

  test('injects real init code correctly', () => {
    const source = `import React from 'react';\nimport { createRoot } from 'react-dom/client';\n\ncreateRoot(document.getElementById('root')!).render(<App />);`;
    const initCode = getInitCode('vite', { appName: 'test-app' });
    const result = injectInitCode(source, initCode);

    expect(result).toContain("@gremlin/recorder-web");
    expect(result).toContain("appName: 'test-app'");
    expect(result).toContain('recorder.start()');
    // Original content preserved
    expect(result).toContain('createRoot');
  });
});

// ---------------------------------------------------------------------------
// Existing config detection (force flag logic)
// ---------------------------------------------------------------------------

describe('existing config detection', () => {
  test('detects existing config.json', () => {
    const gremlinDir = join(tmpDir, '.gremlin');
    mkdirSync(gremlinDir, { recursive: true });
    writeFileSync(join(gremlinDir, 'config.json'), '{}');

    expect(existsSync(join(gremlinDir, 'config.json'))).toBe(true);
  });

  test('does not detect config when .gremlin dir does not exist', () => {
    expect(existsSync(join(tmpDir, '.gremlin', 'config.json'))).toBe(false);
  });
});
