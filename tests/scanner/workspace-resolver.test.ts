import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorkspaceMap } from '../../src/scanner/workspace-resolver.js';
import { writeTree } from '../integration/layer-app.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name: string): string => path.join(fixturesDir, name);

describe('buildWorkspaceMap', () => {
  it('resolves aliases to absolute paths relative to baseUrl', () => {
    const dir = fixture('basic');
    const map = buildWorkspaceMap(dir);

    expect(map['@app']).toBe(path.resolve(dir, 'src'));
    expect(map['@db']).toBe(path.resolve(dir, 'packages/db/index.ts'));
    for (const target of Object.values(map)) {
      expect(path.isAbsolute(target)).toBe(true);
    }
  });

  it('parses JSON with comments and trailing commas', () => {
    const dir = fixture('comments');
    const map = buildWorkspaceMap(dir);

    expect(map['@x']).toBe(path.resolve(dir, 'lib'));
  });

  it('follows extends chains to a parent config that declares the paths', () => {
    const dir = fixture('extends');
    const map = buildWorkspaceMap(dir);

    expect(map['@shared']).toBe(path.resolve(dir, 'configs', 'shared'));
  });

  it('returns an empty map when no paths are declared', () => {
    expect(buildWorkspaceMap(fixture('no-paths'))).toEqual({});
  });

  it('maps top-level baseUrl directories to first-party prefixes (bare specifiers resolve)', () => {
    const dir = fixture('baseurl');
    const map = buildWorkspaceMap(dir);
    expect(map['app']).toBe(path.resolve(dir, 'app'));
    expect(map['utils']).toBe(path.resolve(dir, 'utils'));
  });

  it('returns an empty map when no tsconfig exists', () => {
    expect(buildWorkspaceMap(fixture('does-not-exist'))).toEqual({});
  });
});

describe('buildWorkspaceMap: a paths key whose * follows its prefix directly', () => {
  let dir: string;
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-glued-paths-')));
    writeTree(dir, {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@utils': ['./lib/utils'], '@*': ['./src/*'] } },
      }),
      'src/components/button.tsx': 'export const b = 1;\n',
      'src/main.tsx': 'export const m = 1;\n',
      'src/utils/x.ts': 'export const x = 1;\n',
      'src/notes.md': '# notes\n',
      'lib/utils/index.ts': 'export const u = 1;\n',
    });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('maps the prefix and each folder and source file of the target under it, an explicit key winning', () => {
    const map = buildWorkspaceMap(dir);
    expect(map['@']).toBe(path.join(dir, 'src'));
    expect(map['@components']).toBe(path.join(dir, 'src', 'components'));
    expect(map['@main']).toBe(path.join(dir, 'src', 'main'));
    expect(map['@utils']).toBe(path.join(dir, 'lib', 'utils'));
    expect(map['@notes']).toBeUndefined();
    expect(map['@*']).toBeUndefined();
  });

  it('adds no empty alias for a bare "*" key', () => {
    const bare = path.join(dir, 'bare');
    writeTree(bare, {
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '*': ['./src/*'] } } }),
      'src/components/button.tsx': 'export const b = 1;\n',
    });
    expect(buildWorkspaceMap(bare)).toEqual({ components: path.join(bare, 'src', 'components') });
  });
});
