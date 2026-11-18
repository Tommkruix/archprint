import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { detectTestIsolation } from '../../src/detector/test-isolation-detector.js';
import { walkRepo } from '../../src/scanner/file-walker.js';
import { writeTree } from '../integration/layer-app.js';

const MODULE = 'export const value = 1;\n';

describe('files a test runner config names to run around the tests', () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const repo = (files: Record<string, string>): string => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-setup-')));
    temps.push(dir);
    writeTree(dir, { 'tsconfig.json': '{}', 'package.json': '{"name":"app"}', ...files });
    return dir;
  };
  const testFiles = (dir: string): string[] =>
    walkRepo(dir)
      .filter((file) => file.role === 'TEST')
      .map((file) => file.relativePath)
      .sort();

  it('counts vitest setupFiles and globalSetup as test code, so importing test support is not a break', () => {
    const dir = repo({
      'vitest.config.ts': [
        "import { defineConfig } from 'vitest/config';",
        'export default defineConfig({',
        "  test: { setupFiles: ['./vitest.setup.ts', '@testing-library/jest-dom'], globalSetup: 'global' },",
        '});',
      ].join('\n'),
      'vitest.setup.ts':
        "import { server } from './src/__tests__/support/server';\nserver.listen();\n",
      'global.ts': MODULE,
      'src/__tests__/support/server.ts': 'export const server = { listen() {} };\n',
      'src/setup.ts':
        "import { server } from './__tests__/support/server';\nexport const s = server;\n",
    });
    expect(testFiles(dir)).toEqual([
      'global.ts',
      'src/__tests__/support/server.ts',
      'vitest.setup.ts',
    ]);
    expect(detectTestIsolation(dir).violations).toEqual([
      { file: 'src/setup.ts', target: 'src/__tests__/support/server.ts' },
    ]);
  });

  it('reads a jest config in JavaScript with <rootDir>, the jest field of package.json, and playwright', () => {
    const dir = repo({
      'jest.config.js':
        "module.exports = { setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'], globalTeardown: 'teardown.ts' };\n",
      'package.json': JSON.stringify({ name: 'app', jest: { setupFiles: ['./setupTests.ts'] } }),
      'playwright.config.ts': [
        "import path from 'node:path';",
        "export default { globalSetup: path.resolve(__dirname, 'e2e-setup.ts') };",
      ].join('\n'),
      'jest.setup.ts': MODULE,
      'teardown.ts': MODULE,
      'setupTests.ts': MODULE,
      'e2e-setup.ts': MODULE,
      'main.ts': MODULE,
    });
    expect(testFiles(dir)).toEqual([
      'e2e-setup.ts',
      'jest.setup.ts',
      'setupTests.ts',
      'teardown.ts',
    ]);
  });

  it('reads setup files of nested projects, and no setup key in a config that is not a test runner', () => {
    const dir = repo({
      'vitest.workspace.ts':
        "export default [{ test: { name: 'a', setupFiles: ['packages/a/setup.ts'] } }];\n",
      'app.config.ts': "export default { setupFiles: ['./not-a-test.ts'] };\n",
      'packages/a/setup.ts': MODULE,
      'packages/b/jest.config.js':
        "module.exports = { setupFilesAfterEnv: ['<rootDir>/b-setup.ts'] };\n",
      'packages/b/b-setup.ts': MODULE,
      'packages/c/package.json': JSON.stringify({
        name: 'c',
        jest: { globalSetup: './c-setup.ts' },
      }),
      'packages/c/c-setup.ts': MODULE,
      'not-a-test.ts': MODULE,
    });
    expect(testFiles(dir)).toEqual([
      'packages/a/setup.ts',
      'packages/b/b-setup.ts',
      'packages/c/c-setup.ts',
    ]);
  });

  it('lists a module only a setup file imports as imported only by tests, and the setup file in neither list', () => {
    const dir = repo({
      'package.json': JSON.stringify({
        name: 'app',
        main: 'src/main.ts',
        jest: { setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'] },
      }),
      'jest.setup.ts': "import { server } from './src/mocks/server';\nserver.listen();\n",
      'src/mocks/server.ts': 'export const server = { listen() {} };\n',
      'src/main.ts': MODULE,
    });
    const { orphans, testOnly } = detectOrphans(dir);
    expect(testOnly).toEqual(['src/mocks/server.ts']);
    expect(orphans).toEqual([]);
  });

  it('reads a config in a package below the walked folder, and a file it names outside the walked folder is not walked', () => {
    const dir = repo({
      'apps/web/vitest.config.ts':
        "export default { test: { setupFiles: ['./test-setup.ts', '../../outside.ts'] } };\n",
      'apps/web/test-setup.ts': MODULE,
      'outside.ts': MODULE,
    });
    expect(testFiles(path.join(dir, 'apps', 'web'))).toEqual(['test-setup.ts']);
    expect(testFiles(dir)).toEqual(['apps/web/test-setup.ts', 'outside.ts']);
  });
});
