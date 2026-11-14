import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frameworkFilesUnder } from '../../src/detector/orphan-detector.js';
import { detectOrphans } from '../../src/index.js';
import { writeTree } from '../integration/layer-app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'orphans');

describe('detectOrphans', () => {
  it('reports a file that nothing imports and is not a framework entry', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).toEqual(['lib/orphan.ts']);
  });

  it('does not flag framework entries (page) or config files with zero in-degree', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).not.toContain('page.tsx');
    expect(analysis.orphans).not.toContain('app.config.ts');
  });

  it('excludes test files from the analysis entirely', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).not.toContain('lib/widget.test.ts');
    expect(analysis.fileCount).toBe(4);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    const analysis = detectOrphans(relative);
    expect(analysis.orphans).toEqual(['lib/orphan.ts']);
  });

  describe('in a Next.js app with Storybook, Vitest, type-only imports and barrels', () => {
    let app: string;
    beforeAll(() => {
      app = mkdtempSync(path.join(tmpdir(), 'archprint-orphans-'));
      const files: Record<string, string> = {
        'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
        'app/page.tsx':
          "import { list } from '@/lib/api/all';\nimport type { Pm } from '@/types/pm';\nexport default function Page(p: Pm) { return list(p); }\n",
        'app/robots.ts': 'export default function robots() { return {}; }\n',
        'app/sitemap.ts': 'export default function sitemap() { return []; }\n',
        'app/blog/opengraph-image.tsx': 'export default function Image() { return null; }\n',
        'instrumentation-client.ts': 'export const onRouterTransitionStart = () => {};\n',
        'proxy.ts': 'export function proxy() {}\n',
        'components/button.tsx': 'export const Button = () => null;\n',
        'components/button.stories.tsx':
          "import { Button } from './button';\nexport default { component: Button };\n",
        'vitest.config.ts': "export default { test: { setupFiles: ['./vitest.setup.ts'] } };\n",
        'vitest.setup.ts': 'export {};\n',
        'types/pm.ts': 'export interface Pm { id: string }\n',
        'lib/api/all.ts': "export * from './leaf';\n",
        'lib/api/leaf.ts': 'export const list = (p: unknown) => p;\n',
        'components/pm-view.tsx': 'export const PmView = () => null;\n',
        'components/pm-view.test.tsx':
          "import { PmView } from './pm-view';\nexport const t = PmView;\n",
        'lib/unused.ts': 'export const unused = 1;\n',
      };
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
        writeFileSync(path.join(app, file), content);
      }
    });
    afterAll(() => rmSync(app, { recursive: true, force: true }));

    it('reports only the file nothing references as an orphan', () => {
      expect(detectOrphans(app).orphans).toEqual(['lib/unused.ts']);
    });

    it('reports a production file only its test imports separately', () => {
      expect(detectOrphans(app).testOnly).toEqual(['components/pm-view.tsx']);
    });
  });
});

describe('Next.js pages-router pages', () => {
  const page = 'export default function Page() { return null; }\n';
  let repo: string;
  let hoisted: string;
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'archprint-next-pages-'));
    writeTree(repo, {
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { next: '15.0.0' } }),
      'apps/web/src/pages/trace/[traceId].tsx': page,
      'apps/web/src/components/pages/card.tsx': page,
      'apps/vite/package.json': JSON.stringify({ name: 'vite', dependencies: { react: '19.0.0' } }),
      'apps/vite/src/pages/home.tsx': page,
      'apps/docs/next.config.mjs': 'export default {};\n',
      'apps/docs/pages/guide.tsx': page,
    });
    hoisted = mkdtempSync(path.join(tmpdir(), 'archprint-next-hoisted-'));
    writeTree(hoisted, {
      'package.json': JSON.stringify({
        name: 'root',
        private: true,
        workspaces: ['apps/*'],
        devDependencies: { next: '15.0.0' },
      }),
      'apps/admin/package.json': JSON.stringify({ name: 'admin' }),
      'apps/admin/pages/users.tsx': page,
      'apps/admin/src/components/pages/row.tsx': page,
    });
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(hoisted, { recursive: true, force: true });
  });

  it('are the files under pages/ or src/pages/ of a package that declares next, or of a folder with next.config', () => {
    const isPage = frameworkFilesUnder(repo);
    expect(isPage('apps/web/src/pages/trace/[traceId].tsx')).toBe(true);
    expect(isPage('apps/docs/pages/guide.tsx')).toBe(true);
    expect(frameworkFilesUnder(hoisted)('apps/admin/pages/users.tsx')).toBe(true);
  });

  it('leave out a pages folder below the project root, and one in an app without Next.js', () => {
    const isPage = frameworkFilesUnder(repo);
    expect(isPage('apps/web/src/components/pages/card.tsx')).toBe(false);
    expect(isPage('apps/vite/src/pages/home.tsx')).toBe(false);
    expect(frameworkFilesUnder(hoisted)('apps/admin/src/components/pages/row.tsx')).toBe(false);
  });

  it('are not orphans, while a Vite app page nothing imports still is', () => {
    expect(detectOrphans(path.join(repo, 'apps/web')).orphans).toEqual([
      'src/components/pages/card.tsx',
    ]);
    expect(detectOrphans(path.join(repo, 'apps/vite')).orphans).toEqual(['src/pages/home.tsx']);
  });
});

describe('SvelteKit route and convention files', () => {
  const KIT = JSON.stringify({ name: 'site', devDependencies: { '@sveltejs/kit': '2.0.0' } });
  const CONFIG = 'export default { kit: {} };\n';
  const module = 'export const value = 1;\n';
  const component = '<p>hello</p>\n';
  let repo: string;
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'archprint-sveltekit-routes-'));
    writeTree(repo, {
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }),
      'apps/site/package.json': KIT,
      'apps/site/svelte.config.js': CONFIG,
      'apps/site/src/routes/+page.svelte': component,
      'apps/site/src/routes/+layout.svelte': component,
      'apps/site/src/routes/+error.svelte': component,
      'apps/site/src/routes/(app)/admin/+page@.svelte': component,
      'apps/site/src/routes/blog/[slug]/+layout@(app).svelte': component,
      'apps/site/src/routes/blog/[slug]/Card.svelte': component,
      'apps/site/src/routes/blog/format.ts': module,
      'apps/site/src/hooks.client.ts': module,
      'apps/site/src/hooks.ts': module,
      'apps/site/src/params/slug.ts': module,
      'apps/site/src/params/shared/words.ts': module,
      'apps/site/src/service-worker.ts': module,
      'apps/site/src/instrumentation.server.ts': module,
      'apps/site/src/components/routes/+page.svelte': component,
      'apps/plain/package.json': JSON.stringify({
        name: 'plain',
        devDependencies: { svelte: '5.0.0' },
      }),
      'apps/plain/svelte.config.js': CONFIG,
      'apps/plain/src/routes/+page.svelte': component,
      'apps/next-kit/package.json': KIT,
      'apps/next-kit/vite.config.ts':
        "import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n",
      'apps/next-kit/src/routes/+page.svelte': component,
      'apps/next-kit/src/params.ts': module,
      'apps/vite/package.json': JSON.stringify({
        name: 'vite',
        devDependencies: { vite: '7.0.0' },
      }),
      'apps/vite/vite.config.ts':
        "import { svelte } from '@sveltejs/vite-plugin-svelte';\nexport default { plugins: [svelte()] };\n",
      'apps/vite/src/routes/+page.svelte': component,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('are the files SvelteKit loads by their location in a SvelteKit 2 or SvelteKit 3 project', () => {
    const isLoaded = frameworkFilesUnder(repo);
    for (const file of [
      'src/routes/+page.svelte',
      'src/routes/+page.ts',
      'src/routes/+page.server.js',
      'src/routes/+layout.svelte',
      'src/routes/+layout.ts',
      'src/routes/+layout.server.ts',
      'src/routes/+error.svelte',
      'src/routes/api/+server.ts',
      'src/routes/(app)/admin/+page@.svelte',
      'src/routes/blog/[slug]/+layout@(app).svelte',
      'src/hooks.ts',
      'src/hooks.server.ts',
      'src/hooks.client.ts',
      'src/params/slug.ts',
      'src/service-worker.ts',
      'src/instrumentation.server.ts',
    ]) {
      expect(isLoaded(`apps/site/${file}`), file).toBe(true);
    }
    expect(isLoaded('apps/next-kit/src/routes/+page.svelte')).toBe(true);
    expect(isLoaded('apps/next-kit/src/params.ts')).toBe(true);
  });

  it('leave out other route folder files, nested param folders, routes below the project root, and a project without the kit', () => {
    const isLoaded = frameworkFilesUnder(repo);
    for (const file of [
      'apps/site/src/routes/blog/[slug]/Card.svelte',
      'apps/site/src/routes/blog/format.ts',
      'apps/site/src/params/shared/words.ts',
      'apps/site/src/components/routes/+page.svelte',
      'apps/site/examples/demo/src/routes/+page.svelte',
      'apps/site/src/routes/+page@x/Card.svelte',
      'apps/site/src/lib/hooks.ts',
      'apps/plain/src/routes/+page.svelte',
      'apps/vite/src/routes/+page.svelte',
    ]) {
      expect(isLoaded(file), file).toBe(false);
    }
  });

  it('are not orphans, while a colocated file nothing imports still is', () => {
    expect(detectOrphans(path.join(repo, 'apps/site')).orphans).toEqual([
      'src/components/routes/+page.svelte',
      'src/params/shared/words.ts',
      'src/routes/blog/[slug]/Card.svelte',
      'src/routes/blog/format.ts',
    ]);
    expect(detectOrphans(path.join(repo, 'apps/plain')).orphans).toEqual([
      'src/routes/+page.svelte',
    ]);
    expect(detectOrphans(path.join(repo, 'apps/next-kit')).orphans).toEqual([]);
    expect(detectOrphans(path.join(repo, 'apps/vite')).orphans).toEqual([
      'src/routes/+page.svelte',
    ]);
  });
});
