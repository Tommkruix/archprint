import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { frameworkFilesUnder } from '../../src/detector/file-routes.js';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { writeTree } from '../integration/layer-app.js';

const MODULE = 'export default function Page() { return null; }\n';
const manifest = (dependencies: Record<string, string>): string =>
  JSON.stringify({ name: 'app', private: true, dependencies });

describe('files a file-based router loads by their location', () => {
  const temps: string[] = [];
  const repo = (files: Record<string, string>): string => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-file-routes-')));
    temps.push(dir);
    writeTree(dir, files);
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const loaded = (root: string, files: string[]): string[] =>
    files.filter(frameworkFilesUnder(root));

  it('Expo Router: every file of src/app, which takes precedence over app', () => {
    const root = repo({
      'apps/mobile/package.json': manifest({ expo: '54.0.0', 'expo-router': '6.0.0' }),
      'apps/mobile/src/app/_layout.tsx': MODULE,
      'apps/mobile/src/app/(app)/(tabs)/_layout.tsx': MODULE,
      'apps/mobile/src/app/h/[serverId]/sessions.tsx': MODULE,
      'apps/mobile/src/app/+not-found.tsx': MODULE,
      'apps/mobile/src/app/api/health+api.ts': MODULE,
      'apps/mobile/app/legacy.tsx': MODULE,
      'apps/mobile/src/components/button.tsx': MODULE,
      'apps/web/package.json': manifest({ react: '19.0.0' }),
      'apps/web/src/app/page.tsx': MODULE,
    });
    expect(
      loaded(root, [
        'apps/mobile/src/app/_layout.tsx',
        'apps/mobile/src/app/(app)/(tabs)/_layout.tsx',
        'apps/mobile/src/app/h/[serverId]/sessions.tsx',
        'apps/mobile/src/app/+not-found.tsx',
        'apps/mobile/src/app/api/health+api.ts',
        'apps/mobile/app/legacy.tsx',
        'apps/mobile/src/components/button.tsx',
        'apps/web/src/app/page.tsx',
      ]),
    ).toEqual([
      'apps/mobile/src/app/_layout.tsx',
      'apps/mobile/src/app/(app)/(tabs)/_layout.tsx',
      'apps/mobile/src/app/h/[serverId]/sessions.tsx',
      'apps/mobile/src/app/+not-found.tsx',
      'apps/mobile/src/app/api/health+api.ts',
    ]);
  });

  it('Expo Router: app when there is no src/app', () => {
    const root = repo({
      'package.json': manifest({ 'expo-router': '6.0.0' }),
      'app/(app)/applications/[id]/apply.tsx': MODULE,
    });
    expect(loaded(root, ['app/(app)/applications/[id]/apply.tsx', 'lib/x.ts'])).toEqual([
      'app/(app)/applications/[id]/apply.tsx',
    ]);
  });

  it('React Router flatRoutes: the modules @react-router/fs-routes registers under a configured appDirectory', () => {
    const at = (file: string): string => `packages/insomnia/${file}`;
    const routeFiles = [
      'src/routes/_index.tsx',
      'src/routes/auth.login.tsx',
      'src/routes/git-migration.$.tsx',
      'src/routes/settings/route.tsx',
      'src/routes/settings/index.tsx',
      'src/routes/settings/form.tsx',
      'src/routes/settings/nested/route.tsx',
      'src/routes/billing/route.js',
      'src/routes/billing/route.tsx',
      'src/routes/.draft.tsx',
      'src/routes/.hidden/route.tsx',
      'src/routes/drafts/route.tsx',
      'src/routes/auth.login.test.ts',
      'src/ui/components/modal.tsx',
      'app/routes/home.tsx',
    ];
    const root = repo({
      'packages/insomnia/package.json': manifest({ 'react-router': '7.9.0' }),
      'packages/insomnia/react-router.config.ts':
        "import { type Config } from '@react-router/dev/config';\nexport default { appDirectory: 'src', ssr: false } satisfies Config;\n",
      'packages/insomnia/src/routes.ts':
        "import { flatRoutes } from '@react-router/fs-routes';\nexport default flatRoutes({ ignoredRouteFiles: ['**/*.test.ts', 'routes/drafts'] });\n",
      'packages/insomnia/src/root.tsx': MODULE,
      ...Object.fromEntries(routeFiles.map((file) => [at(file), MODULE])),
    });
    expect(
      loaded(
        root,
        ['src/root.tsx', 'src/routes.ts', 'src/entry.client.tsx', ...routeFiles].map(at),
      ),
    ).toEqual(
      [
        'src/root.tsx',
        'src/routes.ts',
        'src/entry.client.tsx',
        'src/routes/_index.tsx',
        'src/routes/auth.login.tsx',
        'src/routes/git-migration.$.tsx',
        'src/routes/settings/route.tsx',
        'src/routes/billing/route.js',
      ].map(at),
    );
  });

  it('React Router: the module paths routes.ts passes to the route helpers, and a flatRoutes rootDirectory', () => {
    const root = repo({
      'package.json': manifest({ '@react-router/dev': '7.9.0' }),
      'app/routes.ts': [
        "import { index, layout, route as page } from '@react-router/dev/routes';",
        "import { flatRoutes } from '@react-router/fs-routes';",
        "const LEGACY = './routes/legacy.tsx';",
        'export default [',
        "  index('routes/home.tsx'),",
        "  page('about', './routes/about.tsx'),",
        "  layout('routes/shell.tsx', [page('team', 'routes/team.tsx')]),",
        "  route('ignored', 'routes/not-the-helper.tsx'),",
        "  ...(await flatRoutes({ rootDirectory: 'file-routes' })),",
        '];',
      ].join('\n'),
      'app/file-routes/blog.tsx': MODULE,
      'app/file-routes/deep/nested/post.tsx': MODULE,
    });
    expect(
      loaded(root, [
        'app/routes/home.tsx',
        'app/routes/about.tsx',
        'app/routes/shell.tsx',
        'app/routes/team.tsx',
        'app/routes/legacy.tsx',
        'app/routes/not-the-helper.tsx',
        'app/routes/unused.tsx',
        'app/file-routes/blog.tsx',
        'app/file-routes/deep/nested/post.tsx',
      ]),
    ).toEqual([
      'app/routes/home.tsx',
      'app/routes/about.tsx',
      'app/routes/shell.tsx',
      'app/routes/team.tsx',
      'app/file-routes/blog.tsx',
    ]);
  });

  it('React Router: a flatRoutes not imported from @react-router/fs-routes registers nothing', () => {
    const root = repo({
      'package.json': manifest({ '@react-router/dev': '7.9.0' }),
      'app/routes.ts':
        "import { flatRoutes } from './my-routes';\nexport default flatRoutes({ rootDirectory: 'routes' });\n",
      'app/routes/home.tsx': MODULE,
    });
    expect(loaded(root, ['app/routes/home.tsx'])).toEqual([]);
  });

  it('React Router: an appDirectory or flatRoutes option written as code is not guessed', () => {
    const root = repo({
      'web/package.json': manifest({ '@react-router/dev': '7.9.0' }),
      'web/react-router.config.ts': 'export default { appDirectory: process.env.APP_DIR };\n',
      'web/app/root.tsx': MODULE,
      'cli/package.json': manifest({ '@react-router/dev': '7.9.0' }),
      'cli/app/routes.ts':
        "import { flatRoutes } from '@react-router/fs-routes';\nexport default flatRoutes({ rootDirectory: folder });\n",
      'cli/app/routes/x.tsx': MODULE,
    });
    expect(loaded(root, ['web/app/root.tsx', 'cli/app/routes/x.tsx', 'cli/app/root.tsx'])).toEqual([
      'cli/app/root.tsx',
    ]);
  });

  it('TanStack Router: every file under the routesDirectory a config gives the plugin, except "-" names', () => {
    const root = repo({
      'package.json': manifest({
        '@tanstack/react-router': '1.130.0',
        '@tanstack/router-plugin': '1.130.0',
      }),
      'electron.vite.config.ts': [
        "import { TanStackRouterVite } from '@tanstack/router-plugin/vite';",
        'export default {',
        "  renderer: { plugins: [TanStackRouterVite({ target: 'react', routesDirectory: './src/renderer/routes', generatedRouteTree: './src/renderer/routeTree.gen.ts' })] },",
        '};',
      ].join('\n'),
    });
    expect(
      loaded(root, [
        'src/renderer/routes/__root.tsx',
        'src/renderer/routes/copilots/my.tsx',
        'src/renderer/routes/-components/card.tsx',
        'src/renderer/routes/settings/-helpers.ts',
        'src/routes/index.tsx',
        'src/renderer/pages/home.tsx',
      ]),
    ).toEqual(['src/renderer/routes/__root.tsx', 'src/renderer/routes/copilots/my.tsx']);
  });

  it('TanStack Router: ./src/routes by default, with the ignore prefix tsr.config.json sets', () => {
    const root = repo({
      'package.json': manifest({ '@tanstack/router-cli': '1.130.0' }),
      'tsr.config.json': JSON.stringify({ routeFileIgnorePrefix: '~' }),
    });
    expect(
      loaded(root, ['src/routes/index.tsx', 'src/routes/~utils.ts', 'src/routes/-not-ignored.tsx']),
    ).toEqual(['src/routes/index.tsx', 'src/routes/-not-ignored.tsx']);
  });

  it('Routify 2: files of src/pages with its extensions, minus underscored folders and files but layouts', () => {
    const root = repo({
      'packages/builder/package.json': JSON.stringify({
        dependencies: { '@roxi/routify': '2.18.19' },
        scripts: { build: 'routify -b && vite build', dev: 'routify -c dev:vite' },
      }),
      'packages/v3/package.json': manifest({ '@roxi/routify': '^3.0.0' }),
    });
    expect(
      loaded(root, [
        'packages/builder/src/pages/index.svelte',
        'packages/builder/src/pages/_layout.svelte',
        'packages/builder/src/pages/_fallback.svelte',
        'packages/builder/src/pages/builder/[id]/settings.svelte',
        'packages/builder/src/pages/builder/_reset.svelte',
        'packages/builder/src/pages/builder/_layout.workspace.svelte',
        'packages/builder/src/pages/builder/_components/Card.svelte',
        'packages/builder/src/pages/builder/defaultWorkspace.ts',
        'packages/builder/src/components/Unused.svelte',
        'packages/v3/src/pages/index.svelte',
      ]),
    ).toEqual([
      'packages/builder/src/pages/index.svelte',
      'packages/builder/src/pages/_layout.svelte',
      'packages/builder/src/pages/_fallback.svelte',
      'packages/builder/src/pages/builder/[id]/settings.svelte',
      'packages/builder/src/pages/builder/_reset.svelte',
    ]);
  });

  it('Routify 2: pages and extensions from package.json, routify.config.js, script flags and the rollup plugin', () => {
    const settings = (files: Record<string, string>, paths: string[]): string[] =>
      loaded(repo({ ...files }), paths);
    const routify = (extra: object): string =>
      JSON.stringify({ devDependencies: { '@roxi/routify': '~2.1.0' }, ...extra });
    expect(
      settings(
        {
          'package.json': routify({ routify: { pages: './src/routes/', extensions: 'svelte,ts' } }),
        },
        ['src/routes/a.ts', 'src/pages/b.svelte'],
      ),
    ).toEqual(['src/routes/a.ts']);
    expect(
      settings(
        {
          'package.json': routify({}),
          'routify.config.js': "module.exports = { pages: 'app/pages', extensions: ['svelte'] };\n",
        },
        ['app/pages/a.svelte', 'src/pages/b.svelte'],
      ),
    ).toEqual(['app/pages/a.svelte']);
    expect(
      settings(
        {
          'package.json': routify({
            scripts: { dev: 'routify --pages=web/pages', build: 'routify -b' },
          }),
        },
        ['web/pages/a.svelte', 'src/pages/b.svelte', 'lib/c.svelte'],
      ),
    ).toEqual(['web/pages/a.svelte', 'src/pages/b.svelte']);
    expect(
      settings(
        {
          'package.json': routify({}),
          'rollup.config.js': [
            "import routify from '@roxi/routify/plugins/rollup';",
            "export default { plugins: [routify({ pages: 'client/pages', singleBuild: true })] };",
          ].join('\n'),
        },
        ['client/pages/a.svelte', 'src/pages/b.svelte'],
      ),
    ).toEqual(['client/pages/a.svelte']);
    expect(
      settings(
        {
          'package.json': JSON.stringify({
            dependencies: { '@roxi/routify': '2.0.0', 'meteor-node-stubs': '1.0.0' },
          }),
        },
        ['imports/ui/pages/a.svelte', 'src/pages/b.svelte'],
      ),
    ).toEqual(['imports/ui/pages/a.svelte']);
  });

  it('Routify 2: a setting written as code, an ignore glob or a ROUTIFY_ variable in .env is not guessed', () => {
    const pkg = (extra: object): string =>
      JSON.stringify({ dependencies: { '@roxi/routify': '^2.18.0' }, ...extra });
    const page = ['src/pages/a.svelte'];
    expect(loaded(repo({ 'package.json': pkg({ routify: { ignore: '**/_*' } }) }), page)).toEqual(
      [],
    );
    expect(
      loaded(
        repo({ 'package.json': pkg({ scripts: { dev: "routify -i '**/legacy/**'" } }) }),
        page,
      ),
    ).toEqual([]);
    expect(loaded(repo({ 'package.json': pkg({ routify: { pages: 5 } }) }), page)).toEqual([]);
    expect(
      loaded(
        repo({
          'package.json': pkg({}),
          'routify.config.js': 'module.exports = { pages: process.env.PAGES };\n',
        }),
        page,
      ),
    ).toEqual([]);
    expect(
      loaded(
        repo({ 'package.json': pkg({}), 'routify.config.js': 'module.exports = makeConfig();\n' }),
        page,
      ),
    ).toEqual([]);
    expect(loaded(repo({ 'package.json': pkg({}), '.env': 'ROUTIFY_PAGES=x\n' }), page)).toEqual(
      [],
    );
    expect(
      loaded(
        repo({
          'package.json': pkg({}),
          'vite.config.js': [
            "const routify = require('@roxi/routify/plugins/rollup');",
            'module.exports = { plugins: [routify(options)] };',
          ].join('\n'),
        }),
        page,
      ),
    ).toEqual([]);
    expect(loaded(repo({ 'package.json': pkg({ routify: { extensions: [1] } }) }), page)).toEqual(
      [],
    );
    expect(loaded(repo({ 'package.json': '{ not json' }), page)).toEqual([]);
    expect(
      loaded(repo({ 'package.json': pkg({ routify: { extensions: ['svx', 'svelte'] } }) }), page),
    ).toEqual(page);
    expect(
      loaded(repo({ 'package.json': pkg({ scripts: { dev: 'routify -e svx' } }) }), page),
    ).toEqual([]);
    expect(loaded(repo({ 'package.json': pkg({}) }), page)).toEqual(page);
  });

  it('keeps route files off the orphan list and still lists an unused component', () => {
    const root = repo({
      'tsconfig.json': '{}',
      'package.json': manifest({ 'expo-router': '6.0.0' }),
      'app/index.tsx': MODULE,
      'components/unused.tsx': MODULE,
    });
    const { orphans } = detectOrphans(root);
    expect(orphans).toContain('components/unused.tsx');
    expect(orphans).not.toContain('app/index.tsx');
  });
});
