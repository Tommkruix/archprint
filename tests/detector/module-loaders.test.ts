import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { buildReferenceGraph } from '../../src/detector/reference-graph.js';
import { moduleLoaders } from '../../src/scanner/file-walker.js';

const MODULE = 'export const x = 1;\n';

describe('files loaded by import.meta.glob and require.context', () => {
  const temps: string[] = [];
  const repo = (files: Record<string, string>): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-loaders-'));
    temps.push(dir);
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), body);
    }
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const referrersOf = (root: string, file: string): string[] =>
    [...(buildReferenceGraph(root).referrers.get(file) ?? [])].sort();

  it('reads literal glob patterns, arrays with negations, and require.context folders, and skips computed ones', () => {
    const root = repo({
      'main.ts': [
        "const pages = import.meta.glob<{ default: unknown }>('./pages/*.tsx', { eager: true });",
        "const widgets = import.meta.glob(['./widgets/**/*.ts', '!./widgets/**/legacy.ts']);",
        'const computed = import.meta.glob(`./${name}/*.ts`);',
        "const icons = require.context('./icons', false, /\\.icon\\.tsx$/g);",
        "const all = require.context('./all', true, pattern);",
        "const legacy = import.meta.globEager('./legacy/*.ts');",
        "const based = import.meta.glob('./*.ts', { base: './modules', eager: true });",
        "const dynamicBase = import.meta.glob('./*.ts', { base: folder });",
      ].join('\n'),
    });
    expect(moduleLoaders(path.join(root, 'main.ts'))).toEqual([
      { kind: 'glob', patterns: ['./pages/*.tsx'], base: null },
      { kind: 'glob', patterns: ['./widgets/**/*.ts', '!./widgets/**/legacy.ts'], base: null },
      { kind: 'context', directory: './icons', recursive: false, filter: /\.icon\.tsx$/ },
      { kind: 'context', directory: './all', recursive: true, filter: null },
      { kind: 'glob', patterns: ['./legacy/*.ts'], base: null },
      { kind: 'glob', patterns: ['./*.ts'], base: './modules' },
    ]);
  });

  it('counts each file a relative glob matches as referenced, except the negated ones', () => {
    const root = repo({
      'tsconfig.json': '{}',
      'src/main.ts':
        "export const all = import.meta.glob(['./pages/*.tsx', './widgets/**/*.ts', '!./widgets/**/legacy.ts']);\n",
      'src/pages/home.tsx': MODULE,
      'src/pages/nested/deep.tsx': MODULE,
      'src/widgets/chart/chart.ts': MODULE,
      'src/widgets/chart/legacy.ts': MODULE,
    });
    expect(referrersOf(root, 'src/pages/home.tsx')).toEqual(['src/main.ts']);
    expect(referrersOf(root, 'src/widgets/chart/chart.ts')).toEqual(['src/main.ts']);
    expect(referrersOf(root, 'src/pages/nested/deep.tsx')).toEqual([]);
    expect(referrersOf(root, 'src/widgets/chart/legacy.ts')).toEqual([]);
  });

  it('starts an absolute pattern at the nearest Vite config folder, and an alias pattern at its tsconfig path', () => {
    const root = repo({
      'apps/web/tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
      }),
      'apps/web/package.json': '{}',
      'apps/web/src/vite.config.ts': 'export default {};\n',
      'apps/web/src/main.ts':
        "import.meta.glob('/routes/*.ts');\nimport.meta.glob('@/plugins/*/index.ts');\n",
      'apps/web/src/routes/home.ts': MODULE,
      'apps/web/src/plugins/auth/index.ts': MODULE,
      'apps/web/routes/elsewhere.ts': MODULE,
    });
    expect(referrersOf(root, 'apps/web/src/routes/home.ts')).toEqual(['apps/web/src/main.ts']);
    expect(referrersOf(root, 'apps/web/src/plugins/auth/index.ts')).toEqual([
      'apps/web/src/main.ts',
    ]);
    expect(referrersOf(root, 'apps/web/routes/elsewhere.ts')).toEqual([]);
  });

  it('starts an absolute pattern at the nearest package.json folder when there is no Vite config', () => {
    const root = repo({
      'packages/ui/package.json': '{}',
      'packages/ui/src/index.ts': "import.meta.glob('/src/icons/*.ts');\n",
      'packages/ui/src/icons/star.ts': MODULE,
    });
    expect(referrersOf(root, 'packages/ui/src/icons/star.ts')).toEqual([
      'packages/ui/src/index.ts',
    ]);
  });

  it('resolves relative patterns from a literal base folder, relative to the caller or to the Vite root', () => {
    const root = repo({
      'package.json': '{}',
      'src/main.ts':
        "import.meta.glob('./*.ts', { base: './modules' });\nimport.meta.glob('./*.ts', { base: '/plugins' });\n",
      'src/modules/a.ts': MODULE,
      'src/sibling.ts': MODULE,
      'plugins/b.ts': MODULE,
    });
    expect(referrersOf(root, 'src/modules/a.ts')).toEqual(['src/main.ts']);
    expect(referrersOf(root, 'plugins/b.ts')).toEqual(['src/main.ts']);
    expect(referrersOf(root, 'src/sibling.ts')).toEqual([]);
  });

  it('loads the files of a require.context folder its filter matches, deeper ones only when recursive', () => {
    const root = repo({
      'src/main.ts':
        "require.context('./icons', false, /\\.icon\\.tsx$/);\nrequire.context('./all', true, filter);\n",
      'src/icons/star.icon.tsx': MODULE,
      'src/icons/readme.tsx': MODULE,
      'src/icons/nested/moon.icon.tsx': MODULE,
      'src/all/deep/one.ts': MODULE,
    });
    expect(referrersOf(root, 'src/icons/star.icon.tsx')).toEqual(['src/main.ts']);
    expect(referrersOf(root, 'src/icons/readme.tsx')).toEqual([]);
    expect(referrersOf(root, 'src/icons/nested/moon.icon.tsx')).toEqual([]);
    expect(referrersOf(root, 'src/all/deep/one.ts')).toEqual(['src/main.ts']);
  });

  it('keeps a file only a glob loads off the orphan list', () => {
    const root = repo({
      'tsconfig.json': '{}',
      'package.json': '{"name":"app","private":true}',
      'src/registry.ts': "export const pages = import.meta.glob('./pages/*.ts');\n",
      'src/app.ts': "import { pages } from './registry';\nexport const app = pages;\n",
      'src/pages/home.ts': MODULE,
      'src/unused.ts': MODULE,
    });
    const { orphans } = detectOrphans(root);
    expect(orphans).toContain('src/unused.ts');
    expect(orphans).not.toContain('src/pages/home.ts');
  });
});
