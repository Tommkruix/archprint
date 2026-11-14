import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  manifestTargets,
  packageEntriesUnder,
  scriptTargets,
} from '../../src/detector/package-entries.js';
import { detectOrphans } from '../../src/index.js';
import { writeTree } from '../integration/layer-app.js';

const SOURCE = 'export const value = 1;\n';
const json = (value: unknown): string => JSON.stringify(value);

/** One package per way a manifest target reaches a source file. */
const TREE: Record<string, string> = {
  'package.json': json({ name: 'root', private: true, workspaces: ['packages/*'] }),
  'packages/plain/package.json': json({ name: 'plain', main: './src/main.js' }),
  'packages/plain/src/main.ts': SOURCE,
  'packages/explicit/package.json': json({ name: 'explicit', main: './build-out/code/index.js' }),
  'packages/explicit/tsconfig.json': json({
    compilerOptions: { outDir: 'build-out', rootDir: '.' },
  }),
  'packages/explicit/code/index.ts': SOURCE,
  'packages/folder/package.json': json({ name: 'folder', main: './src' }),
  'packages/folder/src/index.ts': SOURCE,
  'packages/typed/package.json': json({ name: 'typed', types: './dist/types.d.ts' }),
  'packages/typed/src/types.ts': SOURCE,
  'packages/inferred/package.json': json({ name: 'inferred', bin: { tool: './compiled/cli.js' } }),
  'packages/inferred/tsconfig.json': json({ extends: './tsconfig.base.json', include: ['code'] }),
  'packages/inferred/tsconfig.base.json': json({ compilerOptions: { outDir: 'compiled' } }),
  'packages/inferred/code/cli.ts': SOURCE,
  'packages/solution/package.json': json({ name: 'solution', main: './out-tsc/index.js' }),
  'packages/solution/tsconfig.json': json({
    compilerOptions: { outDir: 'out-tsc' },
    include: [],
    references: [{ path: './tsconfig.build.json' }],
  }),
  'packages/solution/tsconfig.build.json': json({
    compilerOptions: { outDir: 'out-tsc' },
    include: ['lib'],
  }),
  'packages/solution/lib/index.ts': SOURCE,
  'packages/stated/package.json': json({ name: 'stated', main: './built/index.js' }),
  'packages/stated/tsconfig.json': json({
    compilerOptions: { outDir: 'built', rootDir: 'source' },
    include: [],
  }),
  'packages/stated/source/index.ts': SOURCE,
  'packages/bundled/package.json': json({
    name: 'bundled',
    exports: {
      '.': { types: './dist/index.d.mts', import: './dist/index.mjs' },
      './feature': './src/feature.ts',
      './icons/*': './dist/icons/*.js',
      './legacy/': './src/legacy/',
      './internal/*': null,
    },
  }),
  'packages/bundled/src/index.ts': SOURCE,
  'packages/bundled/src/feature.ts': SOURCE,
  'packages/bundled/src/icons/star.ts': SOURCE,
  'packages/bundled/src/legacy/old.ts': SOURCE,
  'packages/bundled/src/internal/secret.ts': SOURCE,
  'packages/bundled/src/helper.ts': SOURCE,
  'packages/scripted/package.json': json({
    name: 'scripted',
    scripts: {
      start: 'node dist/server.js',
      seed: 'tsx scripts/seed.ts',
      lint: 'eslint "src/**/*.ts"',
    },
  }),
  'packages/scripted/src/server.ts': SOURCE,
  'packages/scripted/scripts/seed.ts': SOURCE,
  'packages/scripted/src/unused.ts': SOURCE,
  'standalone/package.json': json({ name: 'standalone', main: './app/server.ts' }),
  'standalone/app/server.ts': SOURCE,
  'standalone/app/unused.ts': SOURCE,
};

const FILES = Object.keys(TREE).filter((file) => file.endsWith('.ts') && !file.endsWith('.json'));

describe('manifestTargets', () => {
  it('reads main, module, types, browser, bin values and every exports leaf, skipping null and outside paths', () => {
    expect(
      manifestTargets({
        main: 'index.js',
        types: './index.d.ts',
        bin: { a: './bin/a.js', b: '../escape.js' },
        exports: { '.': { import: './dist/x.mjs', default: null }, './y': 'https://example.com/y' },
      }).sort(),
    ).toEqual(['bin/a.js', 'dist/x.mjs', 'index.d.ts', 'index.js']);
  });
});

describe('scriptTargets', () => {
  const run = (...commands: string[]): string[] =>
    scriptTargets({
      scripts: Object.fromEntries(commands.map((command, index) => [index, command])),
    });

  it('takes the first file a runtime runs, behind env, wrappers and package-manager prefixes', () => {
    expect(
      run(
        'node --loader tsx server.ts',
        'cross-env NODE_ENV=production tsx src/main.ts && echo done',
        'bun run script/pack.ts',
        'pnpm exec ts-node scripts/seed.ts',
      ),
    ).toEqual(['server.ts', 'src/main.ts', 'script/pack.ts', 'scripts/seed.ts']);
  });

  it('takes the modules and config a runner flag names, separate or inline', () => {
    expect(run('node -r ./register.cjs --import=./instrument.mjs dist/server.js')).toEqual([
      'register.cjs',
      'instrument.mjs',
      'dist/server.js',
    ]);
  });

  it("runs every chained command, and treats later arguments as the script's input, not entries", () => {
    expect(run('node gen.mjs && node build.mjs', 'node scripts/gen.mjs src/input.ts')).toEqual([
      'gen.mjs',
      'build.mjs',
      'scripts/gen.mjs',
    ]);
  });

  it('ignores other tools, script names, and paths outside the package', () => {
    expect(
      run('eslint "src/**/*.ts" && prettier --write src', 'bun run build', 'node ../tools/x.js'),
    ).toEqual([]);
    expect(scriptTargets({})).toEqual([]);
  });
});

describe('packageEntriesUnder', () => {
  let repo: string;
  let entries: string[];
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-package-entries-')));
    writeTree(repo, TREE);
    entries = [...packageEntriesUnder(repo, FILES)].sort();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('counts a target that names the source file, a .js target for its .ts source included', () => {
    expect(entries).toContain('packages/plain/src/main.ts');
    expect(entries).toContain('packages/bundled/src/feature.ts');
    expect(entries).toContain('packages/folder/src/index.ts');
  });

  it('maps a target in the tsconfig outDir to the source rootDir, explicit or inferred from the inputs', () => {
    expect(entries).toContain('packages/explicit/code/index.ts');
    expect(entries).toContain('packages/inferred/code/cli.ts');
  });

  it('infers no rootDir for a solution-style tsconfig with no inputs, and keeps a stated one', () => {
    expect(entries).toContain('packages/solution/lib/index.ts');
    expect(entries).toContain('packages/stated/source/index.ts');
  });

  it('maps a bundler output folder to src/, across export conditions, * patterns and folder targets', () => {
    expect(entries).toContain('packages/bundled/src/index.ts');
    expect(entries).toContain('packages/bundled/src/icons/star.ts');
    expect(entries).toContain('packages/bundled/src/legacy/old.ts');
    expect(entries).toContain('packages/typed/src/types.ts');
  });

  it('counts the files a package script runs, built paths mapped to their source', () => {
    expect(entries).toContain('packages/scripted/src/server.ts');
    expect(entries).toContain('packages/scripted/scripts/seed.ts');
    expect(entries).not.toContain('packages/scripted/src/unused.ts');
  });

  it('leaves out files no target reaches, a null-blocked subpath included', () => {
    expect(entries).not.toContain('packages/bundled/src/helper.ts');
    expect(entries).not.toContain('packages/bundled/src/internal/secret.ts');
    expect(entries).not.toContain('standalone/app/unused.ts');
  });

  it('reads the nearest package above the scanned folder', () => {
    const app = path.join(repo, 'standalone', 'app');
    expect([...packageEntriesUnder(app, ['server.ts', 'unused.ts'])]).toEqual(['server.ts']);
  });

  it('keeps exposed files out of the orphan list', () => {
    expect(detectOrphans(path.join(repo, 'packages', 'bundled')).orphans).toEqual([
      'src/helper.ts',
      'src/internal/secret.ts',
    ]);
  });
});
