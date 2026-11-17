import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { layerAliases } from '../../src/detector/layer-detector.js';
import {
  aliasPath,
  matchingAliases,
  resolveImportPath,
  resolveImportTarget,
} from '../../src/detector/layer-paths.js';
import { buildReferenceGraph } from '../../src/detector/reference-graph.js';
import { resolveFirstPartyImport } from '../../src/scanner/resolve-import.js';
import { buildWorkspaceMap, workspaceAliases } from '../../src/scanner/workspace-resolver.js';
import { writeTree } from '../integration/layer-app.js';

const MODULE = 'export const x = 1;\n';
const tsconfig = (paths: Record<string, string[]>): string =>
  JSON.stringify({ compilerOptions: { paths } });

describe('tsconfig paths read as TypeScript reads them', () => {
  const temps: string[] = [];
  const repo = (files: Record<string, string>): string => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-path-patterns-')));
    temps.push(dir);
    writeTree(dir, files);
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const referrersOf = (root: string, file: string): string[] =>
    [...(buildReferenceGraph(root).referrers.get(file) ?? [])].sort();

  it('puts the matched text in place of a * that is not the last segment of the target', () => {
    const root = repo({
      'package.json': '{"private":true,"workspaces":["packages/*"]}',
      'tsconfig.json': tsconfig({ '@vue/*': ['./packages/*/src'] }),
      'packages/shared/package.json': '{"name":"@vue/shared"}',
      'packages/shared/src/index.ts': MODULE,
      'packages/shared/src/general.ts': MODULE,
      'packages/runtime-core/src/index.ts':
        "import { x } from '@vue/shared';\nexport const y = x;\n",
    });
    expect(workspaceAliases(root)).toEqual([
      { prefix: '@vue', dir: path.join(root, 'packages/*/src') },
    ]);
    expect(layerAliases(root)).toEqual([{ prefix: '@vue', dir: 'packages/*/src' }]);
    expect(resolveImportPath('a.ts', '@vue/shared', layerAliases(root))).toBe(
      'packages/shared/src',
    );
    expect(
      resolveFirstPartyImport(
        '@vue/shared',
        path.join(root, 'packages/runtime-core/src/index.ts'),
        workspaceAliases(root),
      ),
    ).toBe(path.join(root, 'packages/shared/src/index.ts'));
    expect(referrersOf(root, 'packages/shared/src/index.ts')).toEqual([
      'packages/runtime-core/src/index.ts',
    ]);
  });

  it('tries the targets of a key in order and takes the first that names a file', () => {
    const root = repo({
      'apps/storybook/tsconfig.json': tsconfig({
        '@astryxdesign/core/*': ['../../packages/core/src/*/index.ts', '../../packages/core/src/*'],
      }),
      'apps/storybook/stories/Button.stories.tsx':
        "import { Button } from '@astryxdesign/core/Button';\nimport { cx } from '@astryxdesign/core/utils';\nexport const s = [Button, cx];\n",
      'packages/core/src/Button/index.ts': MODULE,
      'packages/core/src/utils.ts': MODULE,
    });
    const storybook = path.join(root, 'apps/storybook');
    expect(workspaceAliases(storybook).map(({ prefix }) => prefix)).toEqual([
      '@astryxdesign/core',
      '@astryxdesign/core',
    ]);
    expect(buildWorkspaceMap(storybook)).toEqual({
      '@astryxdesign/core': path.join(root, 'packages/core/src/*/index.ts'),
    });
    const story = path.join(storybook, 'stories/Button.stories.tsx');
    expect(
      resolveFirstPartyImport('@astryxdesign/core/utils', story, workspaceAliases(storybook)),
    ).toBe(path.join(root, 'packages/core/src/utils.ts'));
    expect(referrersOf(root, 'packages/core/src/Button/index.ts')).toEqual([
      'apps/storybook/stories/Button.stories.tsx',
    ]);
    expect(referrersOf(root, 'packages/core/src/utils.ts')).toEqual([
      'apps/storybook/stories/Button.stories.tsx',
    ]);
  });

  it('stops at the first target that names a file, so a later variant is not referenced through the key', () => {
    const root = repo({
      'tsconfig.json': tsconfig({
        '#platform': ['./src/platform/node.ts', './src/platform/workerd.ts'],
      }),
      'src/index.ts': "import { x } from '#platform';\nexport const y = x;\n",
      'src/platform/node.ts': MODULE,
      'src/platform/workerd.ts': MODULE,
    });
    expect(referrersOf(root, 'src/platform/node.ts')).toEqual(['src/index.ts']);
    expect(referrersOf(root, 'src/platform/workerd.ts')).toEqual([]);
  });

  it('enumerates the folder before a mid-target * for a key whose * follows its prefix', () => {
    const root = repo({
      'apps/backend/tsconfig.json': tsconfig({ '@teable/v2-*': ['../../packages/v2/*/src/index'] }),
      'apps/backend/src/main.ts': "import { x } from '@teable/v2-core';\nexport const y = x;\n",
      'packages/v2/core/src/index.ts': MODULE,
    });
    expect(workspaceAliases(path.join(root, 'apps/backend'))).toEqual([
      { prefix: '@teable/v2-core', dir: path.join(root, 'packages/v2/core/src/index') },
    ]);
    expect(referrersOf(root, 'packages/v2/core/src/index.ts')).toEqual([
      'apps/backend/src/main.ts',
    ]);
  });

  it("lets a key that matches the package's own name win over the name, as TypeScript reads paths first", () => {
    const root = repo({
      'package.json': '{"private":true,"workspaces":["packages/*"]}',
      'packages/frontend-core/package.json': '{"name":"@budibase/frontend-core"}',
      'packages/frontend-core/tsconfig.json': tsconfig({ '@budibase/*': ['../*/src/index.ts'] }),
      'packages/frontend-core/src/index.ts': MODULE,
      'packages/frontend-core/src/components/Modal.ts':
        "import { x } from '@budibase/frontend-core';\nexport const y = x;\n",
    });
    expect(workspaceAliases(path.join(root, 'packages/frontend-core'))).toEqual([
      { prefix: '@budibase', dir: path.join(root, 'packages/*/src/index.ts') },
    ]);
    expect(referrersOf(root, 'packages/frontend-core/src/index.ts')).toEqual([
      'packages/frontend-core/src/components/Modal.ts',
    ]);
  });

  it('uses an exact key only for the bare name, a * key of the same name for paths below it', () => {
    const root = repo({
      'apps/web/tsconfig.json': tsconfig({
        '@acme/ui': ['../../packages/ui/src/index.ts'],
        '@acme/ui/*': ['../../packages/ui/src/*'],
      }),
      'apps/web/src/page.ts':
        "import { ui } from '@acme/ui';\nimport { button } from '@acme/ui/button';\nexport const p = [ui, button];\n",
      'packages/ui/src/index.ts': MODULE,
      'packages/ui/src/button.ts': MODULE,
    });
    const web = path.join(root, 'apps/web');
    expect(buildWorkspaceMap(web)).toEqual({ '@acme/ui': path.join(root, 'packages/ui/src') });
    expect(workspaceAliases(web)).toEqual([
      { prefix: '@acme/ui', dir: path.join(root, 'packages/ui/src') },
      { prefix: '@acme/ui', dir: path.join(root, 'packages/ui/src/index.ts') },
    ]);
    expect(referrersOf(root, 'packages/ui/src/index.ts')).toEqual(['apps/web/src/page.ts']);
    expect(referrersOf(root, 'packages/ui/src/button.ts')).toEqual(['apps/web/src/page.ts']);
  });

  it('drops a prefix two peer configs map to different target lists, and keeps one they agree on', () => {
    const root = repo({
      'tsconfig.oss.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./src/*'], '#ee/*': ['./src/ee/*', './oss/*'] } },
        include: ['src'],
      }),
      'tsconfig.enterprise.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./src/*'], '#ee/*': ['./src/ee/*', './ee/*'] } },
        include: ['src'],
      }),
      'src/index.ts': MODULE,
    });
    expect(workspaceAliases(root)).toEqual([{ prefix: '@', dir: path.join(root, 'src') }]);
  });
});

describe('matchingAliases', () => {
  it('keeps every target of the longest matching prefix, in order, wherever it is declared', () => {
    const aliases = [
      { prefix: '@', dir: 'src' },
      { prefix: '@/components', dir: 'ui' },
      { prefix: '@/components', dir: 'legacy/ui' },
    ];
    expect(matchingAliases('@/components/button', aliases)).toEqual(aliases.slice(1));
    expect(matchingAliases('@/lib/db', aliases)).toEqual([aliases[0]]);
    expect(matchingAliases('@x/y', aliases)).toEqual([]);
  });
});

describe('aliasPath', () => {
  it('appends to a plain target, substitutes a * literally, and maps nothing onto a * that would match nothing', () => {
    expect(aliasPath({ prefix: '@', dir: 'src' }, '@/lib/db')).toBe('src/lib/db');
    expect(aliasPath({ prefix: '@vue', dir: 'packages/*/src' }, '@vue/shared')).toBe(
      'packages/shared/src',
    );
    expect(aliasPath({ prefix: '@x', dir: 'pkg/*/index' }, '@x/$&a')).toBe('pkg/$&a/index');
    expect(aliasPath({ prefix: '@vue', dir: 'packages/*/src' }, '@vue')).toBeNull();
  });
});

describe('resolveImportTarget with an alias whose targets name no file', () => {
  const fileFor = (base: string): string | null =>
    base === 'packages/types/src/index.ts' ? base : null;
  const packages = [
    {
      name: '@budibase/types',
      dir: 'packages/types',
      entry: 'packages/types/src/index.ts',
      subpaths: [],
    },
  ];

  it('falls through to the workspace package, as TypeScript falls through to node_modules', () => {
    const aliases = [{ prefix: '@budibase', dir: 'packages/*/dist/index.js' }];
    expect(
      resolveImportTarget(
        'packages/builder/a.ts',
        '@budibase/types',
        aliases,
        packages,
        [],
        fileFor,
      ),
    ).toBe('packages/types/src/index.ts');
  });

  it('keeps the first target path when no package claims the import either', () => {
    const aliases = [
      { prefix: '@budibase', dir: 'packages/*/dist/index.js' },
      { prefix: '@budibase', dir: 'packages/*' },
    ];
    expect(
      resolveImportTarget(
        'packages/builder/a.ts',
        '@budibase/backend',
        aliases,
        packages,
        [],
        fileFor,
      ),
    ).toBe('packages/backend/dist/index.js');
  });
});
