import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigration } from '../../src/cli/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'deep-relative-auto');

const WIRED_CONFIG = [
  '// archprint:start (managed by archprint; run `archprint eject` to remove)',
  "import archprintRules from './archprint-rules/eslint.archprint.mjs';",
  '// archprint:end',
  'export default [',
  '  ...archprintRules, // archprint:managed',
  '];',
  '',
].join('\n');

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'archprint-migrate-'));
  cpSync(fixture, tmp, { recursive: true });
  mkdirSync(path.join(tmp, 'archprint-rules'), { recursive: true });
  writeFileSync(path.join(tmp, 'archprint-rules', 'eslint.archprint.mjs'), 'export default [];\n');
  writeFileSync(
    path.join(tmp, 'archprint-rules', '.archprint-outputs.json'),
    JSON.stringify({ archprintVersion: '0.5.0', outputs: ['eslint.archprint.mjs'] }),
  );

  writeFileSync(
    path.join(tmp, 'archprint.json'),
    JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: 'archprint-rules' }),
  );
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('runMigration', () => {
  it('deletes only the legacy files archprint listed, never a folder the legacy config points at', () => {
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(path.join(tmp, 'src', 'keep.ts'), 'export const keep = 1;\n');
    writeFileSync(path.join(tmp, 'archprint-rules', 'notes.md'), 'mine\n');
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: '../outside' }),
    );
    expect(runMigration(tmp, '0.6.0').status).toBe('migrated');
    expect(existsSync(path.join(tmp, 'archprint-rules', 'eslint.archprint.mjs'))).toBe(false);
    expect(readFileSync(path.join(tmp, 'archprint-rules', 'notes.md'), 'utf8')).toBe('mine\n');
    expect(existsSync(path.join(tmp, 'src', 'keep.ts'))).toBe(true);
  });

  it('deletes nothing through a legacy folder that is a symlink', () => {
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(path.join(tmp, 'src', 'keep.ts'), 'export const keep = 1;\n');
    writeFileSync(
      path.join(tmp, '.archprint-outputs.json'),
      JSON.stringify({ archprintVersion: '0.5.0', outputs: ['src'] }),
    );
    symlinkSync(tmp, path.join(tmp, 'linked-rules'), 'dir');
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: 'linked-rules' }),
    );
    runMigration(tmp, '0.6.0');
    expect(existsSync(path.join(tmp, 'src', 'keep.ts'))).toBe(true);
  });

  it('removes a custom legacy folder once the files archprint listed in it are gone', () => {
    mkdirSync(path.join(tmp, 'old-rules'), { recursive: true });
    writeFileSync(path.join(tmp, 'old-rules', 'eslint.archprint.mjs'), 'export default [];\n');
    writeFileSync(
      path.join(tmp, 'old-rules', '.archprint-outputs.json'),
      JSON.stringify({ archprintVersion: '0.5.0', outputs: ['eslint.archprint.mjs'] }),
    );
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: 'old-rules' }),
    );
    expect(runMigration(tmp, '0.6.0').status).toBe('migrated');
    expect(existsSync(path.join(tmp, 'old-rules'))).toBe(false);
  });

  it('never deletes a folder outside the legacy output, even when the legacy config names one', () => {
    mkdirSync(path.join(tmp, 'lib'), { recursive: true });
    writeFileSync(path.join(tmp, 'lib', 'keep.ts'), 'export const keep = 1;\n');
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: 'lib' }),
    );
    runMigration(tmp, '0.6.0');
    expect(existsSync(path.join(tmp, 'lib', 'keep.ts'))).toBe(true);
  });

  it('rewrites a wired config, writes the new layout, and removes the old artifacts', () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), WIRED_CONFIG);
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('migrated');
    expect(existsSync(path.join(tmp, '.archprint', 'eslint.mjs'))).toBe(true);
    expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(false);
    expect(existsSync(path.join(tmp, 'archprint.json'))).toBe(false);
    expect(readFileSync(path.join(tmp, 'eslint.config.mjs'), 'utf8')).toContain(
      "import archprintRules from './.archprint/eslint.mjs';",
    );
  });

  it('--dry-run changes nothing on disk', () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), WIRED_CONFIG);
    const result = runMigration(tmp, '0.6.0', { dryRun: true });
    expect(result.status).toBe('migrated');
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(false);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
    expect(readFileSync(path.join(tmp, 'eslint.config.mjs'), 'utf8')).toBe(WIRED_CONFIG);
  });

  it('aborts before deleting when an unmarked plugin import cannot be rewritten', () => {
    writeFileSync(
      path.join(tmp, 'eslint.config.mjs'),
      "import plugin from './archprint-rules/eslint-plugin.archprint.mjs';\nexport default plugin;\n",
    );
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('aborted');
    expect(result.reason).toContain('eslint-plugin.archprint.mjs');
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(false);
  });

  it('rewrites an unmarked shareable-preset import', () => {
    writeFileSync(
      path.join(tmp, 'eslint.config.mjs'),
      "import archprint from './archprint-rules/eslint-preset.archprint.mjs';\nexport default [...archprint];\n",
    );
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('migrated');
    expect(readFileSync(path.join(tmp, 'eslint.config.mjs'), 'utf8')).toContain(
      "import archprint from './.archprint/eslint.mjs';",
    );
  });

  it('reports nothing to migrate when there is no legacy layout', () => {
    rmSync(path.join(tmp, 'archprint-rules'), { recursive: true, force: true });
    rmSync(path.join(tmp, 'archprint.json'), { force: true });
    expect(runMigration(tmp, '0.6.0').status).toBe('nothing');
  });

  it('retargets a wired dependency-cruiser.json extends', () => {
    const publicApi = path.join(here, '..', 'fixtures', 'public-api-auto');
    rmSync(tmp, { recursive: true, force: true });
    cpSync(publicApi, tmp, { recursive: true });
    mkdirSync(path.join(tmp, 'archprint-rules'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: 'archprint-rules' }),
    );
    writeFileSync(
      path.join(tmp, '.dependency-cruiser.json'),
      JSON.stringify({
        extends: './archprint-rules/dependency-cruiser.all.archprint.json',
        forbidden: [],
      }),
    );
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('migrated');
    const wired = JSON.parse(readFileSync(path.join(tmp, '.dependency-cruiser.json'), 'utf8')) as {
      extends?: string;
    };
    expect(wired.extends).toBe('./.archprint/dependency-cruiser.json');
    expect(existsSync(path.join(tmp, '.archprint', 'dependency-cruiser.json'))).toBe(true);
  });

  it('aborts on a non-JSON dependency-cruiser config that references archprint', () => {
    writeFileSync(
      path.join(tmp, '.dependency-cruiser.js'),
      "module.exports = { extends: './archprint-rules/dependency-cruiser.all.archprint.json' };\n",
    );
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('aborted');
    expect(result.reason).toContain('.dependency-cruiser.js');
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(false);
  });

  it('falls back to app discovery when the recorded app path is stale', () => {
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({
        archprintVersion: '0.5.0',
        app: 'does-not-exist',
        rulesDir: 'archprint-rules',
      }),
    );
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('migrated');
    expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(true);
  });

  it('tolerates a corrupt archprint.json', () => {
    writeFileSync(path.join(tmp, 'archprint.json'), 'not json');
    expect(runMigration(tmp, '0.6.0').status).toBe('migrated');
  });

  it('retargets a managed import written with double quotes (Prettier singleQuote:false)', () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), WIRED_CONFIG.replace(/'/g, '"'));
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('migrated');
    expect(readFileSync(path.join(tmp, 'eslint.config.mjs'), 'utf8')).toContain(
      'import archprintRules from "./.archprint/eslint.mjs";',
    );
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(false);
  });

  it('aborts on a double-quoted unmarked plugin import', () => {
    writeFileSync(
      path.join(tmp, 'eslint.config.mjs'),
      'import plugin from "./archprint-rules/eslint-plugin.archprint.mjs";\nexport default plugin;\n',
    );
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('aborted');
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
  });

  it('aborts before deleting when the repo no longer emits the wired rule set', () => {
    const reject = path.join(here, '..', 'fixtures', 'ui-infer');
    rmSync(tmp, { recursive: true, force: true });
    cpSync(reject, tmp, { recursive: true });
    mkdirSync(path.join(tmp, 'archprint-rules'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.' }),
    );
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), WIRED_CONFIG);
    const result = runMigration(tmp, '0.6.0');
    expect(result.status).toBe('aborted');
    expect(result.reason).toContain('no longer produces ESLint rules');
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(false);
  });
});
