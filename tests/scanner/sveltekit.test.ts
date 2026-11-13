import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { svelteKitAliases, svelteKitModules } from '../../src/scanner/sveltekit.js';
import { buildWorkspaceMap } from '../../src/scanner/workspace-resolver.js';
import { detectOrphans } from '../../src/index.js';
import { writeTree } from '../integration/layer-app.js';

const json = (value: unknown): string => JSON.stringify(value);
const KIT = json({ name: 'app', devDependencies: { '@sveltejs/kit': '2.0.0' } });
const TSCONFIG = json({
  extends: './.svelte-kit/tsconfig.json',
  compilerOptions: { strict: true },
});

describe('svelteKitAliases', () => {
  let root: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-sveltekit-')));
    writeTree(root, {
      'default/package.json': KIT,
      'default/svelte.config.js': 'export default { kit: { adapter: adapter() } };\n',
      'custom/package.json': KIT,
      'custom/svelte.config.js': `const config = {
  kit: {
    files: { lib: 'source/lib' },
    alias: { $components: 'src/components', '@ui/*': 'src/ui/*', computed: path.resolve('x') },
  },
};
export default config;
`,
      'computed/package.json': KIT,
      'computed/svelte.config.js':
        "export default { kit: { files: { lib: path.join('shared', 'lib') } } };\n",
      'spread/package.json': KIT,
      'spread/svelte.config.js': 'export default { kit: { files: sharedFiles } };\n',
      'plain/package.json': json({ name: 'plain', devDependencies: { svelte: '5.0.0' } }),
      'plain/svelte.config.js': 'export default { preprocess: [] };\n',
      'vite-kit/package.json': KIT,
      'vite-kit/vite.config.ts':
        "import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n",
      'vite-undeclared/package.json': json({
        name: 'vite-undeclared',
        devDependencies: { vite: '7.0.0' },
      }),
      'vite-undeclared/vite.config.ts':
        "import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n",
      'vite-svelte/package.json': json({ name: 'vite-svelte', devDependencies: { vite: '7.0.0' } }),
      'vite-svelte/vite.config.js':
        "import { svelte } from '@sveltejs/vite-plugin-svelte';\nexport default { plugins: [svelte()] };\n",
      'mapped/package.json': KIT,
      'mapped/svelte.config.js': 'export default { kit: {} };\n',
      'mapped/tsconfig.json': json({ compilerOptions: { paths: { $lib: ['./elsewhere'] } } }),
    });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('maps $lib to src/lib by default', () => {
    expect(svelteKitAliases(path.join(root, 'default'))).toEqual({
      $lib: path.join(root, 'default', 'src', 'lib'),
    });
  });

  it('reads kit.files.lib and the string entries of kit.alias', () => {
    const dir = path.join(root, 'custom');
    expect(svelteKitAliases(dir)).toEqual({
      $lib: path.join(dir, 'source', 'lib'),
      $components: path.join(dir, 'src', 'components'),
      '@ui': path.join(dir, 'src', 'ui'),
    });
  });

  it('maps no $lib when kit.files or kit.files.lib is computed rather than written as text', () => {
    expect(svelteKitAliases(path.join(root, 'computed'))).toEqual({});
    expect(svelteKitAliases(path.join(root, 'spread'))).toEqual({});
  });

  it('maps $lib to src/lib in a SvelteKit 3 project, configured in its Vite config', () => {
    expect(svelteKitAliases(path.join(root, 'vite-kit'))).toEqual({
      $lib: path.join(root, 'vite-kit', 'src', 'lib'),
    });
    expect(svelteKitModules(path.join(root, 'vite-kit'))).toEqual([
      '$app',
      '$env',
      '$service-worker',
    ]);
  });

  it('adds nothing to a Svelte project without SvelteKit', () => {
    for (const dir of ['plain', 'vite-svelte', 'vite-undeclared']) {
      expect(svelteKitAliases(path.join(root, dir)), dir).toEqual({});
      expect(svelteKitModules(path.join(root, dir)), dir).toEqual([]);
    }
  });

  it('lists the virtual modules of a SvelteKit project', () => {
    expect(svelteKitModules(path.join(root, 'default'))).toEqual([
      '$app',
      '$env',
      '$service-worker',
    ]);
  });

  it('lets a tsconfig alias for $lib win in the workspace map', () => {
    expect(buildWorkspaceMap(path.join(root, 'mapped')).$lib).toBe(
      path.join(root, 'mapped', 'elsewhere'),
    );
  });
});

describe('orphans in a SvelteKit app without its generated tsconfig', () => {
  let app: string;
  beforeAll(() => {
    app = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-sveltekit-app-')));
    writeTree(app, {
      'package.json': KIT,
      'svelte.config.js': 'export default { kit: {} };\n',
      'tsconfig.json': TSCONFIG,
      'src/routes/api/counter/+server.ts':
        "import { record } from '$lib/server/counter';\nexport const POST = record;\n",
      'src/lib/server/counter.ts': 'export const record = 1;\n',
      'src/lib/server/unused.ts': 'export const unused = 1;\n',
    });
  });
  afterAll(() => rmSync(app, { recursive: true, force: true }));

  it('counts imports through $lib', () => {
    const { orphans } = detectOrphans(app);
    expect(orphans).not.toContain('src/lib/server/counter.ts');
    expect(orphans).toContain('src/lib/server/unused.ts');
  });
});
