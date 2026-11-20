import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shippedByFiles, shippedFilesUnder } from '../../src/detector/published-files.js';
import { detectOrphans } from '../../src/index.js';
import { writeTree } from '../integration/layer-app.js';

const SOURCE = 'export const value = 1;\n';
const json = (value: unknown): string => JSON.stringify(value);

describe('shippedByFiles', () => {
  const ships = (files: string[], file: string): boolean => shippedByFiles(files)(file);

  it('ships what an entry names: a folder and its contents, a glob, a file', () => {
    expect(ships(['/lib/'], 'lib/render.js')).toBe(true);
    expect(ships(['lib'], 'lib/deep/render.js')).toBe(true);
    expect(ships(['lib/**/*.js'], 'lib/model.js')).toBe(true);
    expect(ships(['lib/**/*.js'], 'lib/model.d.ts')).toBe(false);
    expect(ships(['/index.{d.ts,js}'], 'index.js')).toBe(true);
    expect(ships(['/lib/'], 'src/lib/render.js')).toBe(false);
  });

  it('reaches a nested file only through folders npm walks into, as npm pack does', () => {
    expect(ships(['**/*.js'], 'Rendering/voxel.js')).toBe(true);
    expect(ships(['*.js'], 'index.js')).toBe(true);
    expect(ships(['*.js'], 'Rendering/voxel.js')).toBe(false);
    expect(ships(['web'], 'web/client.js')).toBe(true);
    expect(ships(['web'], 'bench/fixtures/src/web/client.js')).toBe(false);
    expect(ships(['src/**/web'], 'src/a/web/x.ts')).toBe(false);
    expect(ships(['./dist'], 'dist/a.js')).toBe(true);
    expect(ships(['./dist'], 'src/dist/a.js')).toBe(false);
    expect(ships(['dist/*'], 'dist/a/b.js')).toBe(true);
  });

  it('lets a later ! entry exclude, the last matching entry deciding', () => {
    expect(ships(['/lib/', '!/lib/tests/'], 'lib/tests/a.js')).toBe(false);
    expect(ships(['/lib/', '!/lib/tests/', '/lib/tests/keep.js'], 'lib/tests/keep.js')).toBe(true);
    expect(ships([], 'index.js')).toBe(false);
  });
});

/** The gate-3 shapes: tsc into lib/ (xstate), tsc into the package folder (lit), a sibling public package that
 * compiles a private one (Babylon), a package packed from another folder (handsontable). */
const TREE: Record<string, string> = {
  'package.json': json({
    name: 'root',
    private: true,
    workspaces: ['packages/*', 'packages/public/*'],
  }),
  'packages/core/package.json': json({
    name: 'xstate',
    main: 'lib/index.js',
    files: ['dist', 'lib/**/*.js', 'lib/**/*.d.ts'],
  }),
  'packages/core/tsconfig.json': json({
    compilerOptions: { outDir: './lib', rootDir: './src', allowJs: true },
    include: ['src/**/*'],
  }),
  'packages/core/src/index.ts': SOURCE,
  'packages/core/src/model.ts': SOURCE,
  'packages/core/scripts/release.ts': SOURCE,
  'packages/core/src/legacy.js': SOURCE,
  'packages/esm/package.json': json({ name: 'esm-lib', files: ['lib/**/*.mjs'] }),
  'packages/esm/tsconfig.json': json({ compilerOptions: { outDir: 'lib', rootDir: 'src' } }),
  'packages/esm/src/esm.mts': SOURCE,
  'packages/npmignored/package.json': json({ name: 'npmignored', main: 'index.js' }),
  'packages/npmignored/.npmignore': '# examples stay home\n/examples/\n__tests__\n',
  'packages/npmignored/src/helper.ts': SOURCE,
  'packages/npmignored/examples/basic/App.ts': SOURCE,
  'packages/gitignored/package.json': json({
    name: 'gitignored',
    publishConfig: { access: 'public' },
  }),
  'packages/gitignored/.gitignore': 'dist/\nscripts\n',
  'packages/gitignored/src/kept.ts': SOURCE,
  'packages/gitignored/src/dist/ignored.ts': SOURCE,
  'packages/gitignored/scripts/ignored.ts': SOURCE,
  'packages/bare/package.json': json({ name: 'bare', publishConfig: { access: 'public' } }),
  'packages/bare/src/anything.ts': SOURCE,
  'packages/ssr/package.json': json({
    name: '@lit-labs/ssr',
    main: 'index.js',
    files: ['/lib/', '!/lib/tests/', '/index.{d.ts,js}'],
  }),
  'packages/ssr/tsconfig.json': json({
    compilerOptions: { outDir: '.', rootDir: './src' },
    include: ['src/**/*.ts'],
    exclude: [],
  }),
  'packages/ssr/src/lib/render-shim.ts': SOURCE,
  'packages/ssr/src/lib/tests/helper.ts': SOURCE,
  'packages/ssr/src/other/unshipped.ts': SOURCE,
  'packages/dev-core/package.json': json({ name: '@dev/core', private: true, main: 'dist/index' }),
  'packages/dev-core/src/voxel.ts': SOURCE,
  'packages/public/core/package.json': json({
    name: '@babylonjs/core',
    main: 'index.js',
    files: ['**/*.js', '**/*.d.ts'],
  }),
  'packages/public/core/tsconfig.build.json': json({
    compilerOptions: { outDir: './', rootDir: '../../dev-core/src' },
    include: ['../../dev-core/src/**/*'],
  }),
  'packages/public/umd/package.json': json({ name: 'babylonjs', main: 'babylon.js', files: ['*'] }),
  'packages/public/umd/tsconfig.build.json': json({
    compilerOptions: { outDir: './dist', rootDir: '../../' },
    include: ['./src/**/*', '../../dev-core/src/**/*'],
  }),
  'packages/tools-tests/package.json': json({ name: '@tools/tests', private: true }),
  'packages/tools-tests/src/scene.ts': SOURCE,
  'handsontable/package.json': json({
    name: 'handsontable',
    main: 'index',
    files: ['dist'],
    publishConfig: { directory: 'tmp' },
  }),
  'handsontable/src/iconsMap.ts': SOURCE,
  'packages/embed/package.json': json({ name: '@calcom/embed-core', files: ['dist'] }),
  'packages/embed/tsconfig.json': json({
    compilerOptions: { outDir: 'dist' },
    include: ['src', '*.ts'],
  }),
  'packages/embed/index.ts': SOURCE,
  'packages/embed/src/embed.ts': SOURCE,
  'packages/embed/playground/init.ts': SOURCE,
  'packages/typecheck/package.json': json({ name: 'typecheck-only', files: ['dist'] }),
  'packages/typecheck/tsconfig.json': json({
    compilerOptions: { outDir: 'dist', rootDir: 'src', noEmit: true },
  }),
  'packages/typecheck/src/checked.ts': SOURCE,
  'packages/exported/package.json': json({
    name: 'exported',
    exports: { '.': './dist/index.js' },
    files: ['dist'],
  }),
  'packages/exported/tsconfig.json': json({
    compilerOptions: { outDir: './dist', rootDir: './src' },
  }),
  'packages/exported/src/internal.ts': SOURCE,
  'packages/private/package.json': json({ name: 'private-lib', private: true, files: ['src'] }),
  'packages/private/src/internal.ts': SOURCE,
  'packages/private-string/package.json': json({
    name: 'flagged',
    private: 'true',
    files: ['src'],
  }),
  'packages/private-string/src/internal.ts': SOURCE,
  'apps/desktop/package.json': json({ name: 'desktop', version: '1.0.0', main: 'dist/main.js' }),
  'apps/desktop/tsconfig.json': json({ compilerOptions: { outDir: './dist', rootDir: './src' } }),
  'apps/desktop/src/leftover.ts': SOURCE,
};

const FILES = Object.keys(TREE).filter((file) => /\.(m?ts|js)$/.test(file));

describe('shippedFilesUnder', () => {
  let repo: string;
  let shipped: string[];
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-published-')));
    writeTree(repo, TREE);
    shipped = [...shippedFilesUnder(repo, FILES)].sort();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('ships a file whose tsc output the files list packs, outDir in a folder or the package itself', () => {
    expect(shipped).toContain('packages/core/src/model.ts');
    expect(shipped).toContain('packages/ssr/src/lib/render-shim.ts');
    expect(shipped).toContain('packages/core/src/legacy.js');
    expect(shipped).toContain('packages/esm/src/esm.mts');
  });

  it('reads the .npmignore, else the .gitignore, of a package without a files list, packing all without either', () => {
    expect(shipped).toContain('packages/bare/src/anything.ts');
    expect(shipped).toContain('packages/npmignored/src/helper.ts');
    expect(shipped).not.toContain('packages/npmignored/examples/basic/App.ts');
    expect(shipped).toContain('packages/gitignored/src/kept.ts');
    expect(shipped).not.toContain('packages/gitignored/src/dist/ignored.ts');
    expect(shipped).not.toContain('packages/gitignored/scripts/ignored.ts');
  });

  it('does not ship a file the files list leaves out or excludes, or one no tsconfig builds', () => {
    expect(shipped).not.toContain('packages/ssr/src/lib/tests/helper.ts');
    expect(shipped).not.toContain('packages/ssr/src/other/unshipped.ts');
    expect(shipped).not.toContain('packages/core/scripts/release.ts');
  });

  it("builds only a tsconfig's input files, and nothing when it does not emit", () => {
    expect(shipped).toContain('packages/embed/src/embed.ts');
    expect(shipped).toContain('packages/embed/index.ts');
    expect(shipped).not.toContain('packages/embed/playground/init.ts');
    expect(shipped).not.toContain('packages/typecheck/src/checked.ts');
  });

  it("ships a private package's file that a published sibling compiles through a rootDir outside it", () => {
    expect(shipped).toContain('packages/dev-core/src/voxel.ts');
    expect(shipped).not.toContain('packages/tools-tests/src/scene.ts');
  });

  it('ships every file of a package packed from another folder', () => {
    expect(shipped).toContain('handsontable/src/iconsMap.ts');
  });

  it('ships nothing from a package with exports, a private one, or one not set up to publish', () => {
    expect(shipped).not.toContain('packages/exported/src/internal.ts');
    expect(shipped).not.toContain('packages/private/src/internal.ts');
    expect(shipped).not.toContain('packages/private-string/src/internal.ts');
    expect(shipped).not.toContain('apps/desktop/src/leftover.ts');
  });

  it('lists a shipped file nothing imports apart from the orphans', () => {
    const analysis = detectOrphans(path.join(repo, 'packages', 'core'));
    expect(analysis.shipped).toEqual(['src/model.ts']);
    expect(analysis.orphans).toEqual(['scripts/release.ts']);
  });
});

describe('shippedFilesUnder: a published package at the scanned root', () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-published-root-')));
    writeTree(repo, {
      'package.json': json({
        name: 'plain-lib',
        files: ['src', 'packages'],
        workspaces: ['packages/*'],
      }),
      'src/helper.ts': SOURCE,
      'scripts/build.ts': SOURCE,
      'packages/member/package.json': json({ name: 'member', private: true }),
      'packages/member/src/unused.ts': SOURCE,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('ships the files its files list packs as they are, with no tsconfig, but not its workspace packages', () => {
    const files = ['src/helper.ts', 'scripts/build.ts', 'packages/member/src/unused.ts'];
    expect([...shippedFilesUnder(repo, files)]).toEqual(['src/helper.ts']);
  });
});
