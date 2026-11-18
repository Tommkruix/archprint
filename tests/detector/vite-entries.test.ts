import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { writeTree } from '../integration/layer-app.js';

const MODULE = 'export const value = 1;\n';

describe('files a Vite project starts from', () => {
  const temps: string[] = [];
  const orphansOf = (files: Record<string, string>): string[] => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-vite-')));
    temps.push(dir);
    writeTree(dir, { 'tsconfig.json': '{}', 'package.json': '{"name":"app"}', ...files });
    return detectOrphans(dir).orphans;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("counts the module scripts of the root's index.html, not classic, ignored, external or commented-out ones", () => {
    const orphans = orphansOf({
      'vite.config.ts': 'export default {};\n',
      'index.html': [
        '<!doctype html>',
        '<SCRIPT TYPE="module" SRC="/src/main.tsx?v=2"></SCRIPT>',
        '<script src="/src/classic.ts"></script>',
        '<script type="module" src="/src/skipped.ts" vite-ignore></script>',
        '<script type="module" src="//src/remote.ts"></script>',
        '<script type="module" src="/src/first.ts" src="/src/second.ts"></script>',
        '<!-- <script type="module" src="/src/commented.ts"></script> -->',
        '<script type="module" src="widgets/chart.ts"></script>',
      ].join('\n'),
      'src/main.tsx': MODULE,
      'src/classic.ts': MODULE,
      'src/skipped.ts': MODULE,
      'src/remote.ts': MODULE,
      'src/commented.ts': MODULE,
      'widgets/chart.ts': MODULE,
      'src/first.ts': MODULE,
      'src/second.ts': MODULE,
    });
    expect(orphans).not.toContain('src/main.tsx');
    expect(orphans).not.toContain('widgets/chart.ts');
    expect(orphans).not.toContain('src/first.ts');
    expect(orphans).toEqual(
      expect.arrayContaining([
        'src/classic.ts',
        'src/skipped.ts',
        'src/remote.ts',
        'src/commented.ts',
        'src/second.ts',
      ]),
    );
  });

  it('counts the path imports of an inline module script, not a classic one', () => {
    const orphans = orphansOf({
      'vite.config.ts': 'export default {};\n',
      'index.html': [
        '<script type="module">',
        "  import { boot } from './src/boot';",
        "  import '/src/styles.ts';",
        "  import 'some-package';",
        '  boot();',
        '</script>',
        "<script>import('./src/legacy.ts')</script>",
      ].join('\n'),
      'src/boot.ts': MODULE,
      'src/styles.ts': MODULE,
      'src/legacy.ts': MODULE,
      'some-package.ts': MODULE,
    });
    expect(orphans).not.toContain('src/boot.ts');
    expect(orphans).not.toContain('src/styles.ts');
    expect(orphans).toContain('src/legacy.ts');
    expect(orphans).toContain('some-package.ts');
  });

  it('leaves a /-path to a public file alone, and reads it from the root when publicDir is false', () => {
    const publicDefault = orphansOf({
      'vite.config.ts': 'export default {};\n',
      'index.html': '<script type="module" src="/sw.ts"></script>',
      'public/sw.ts': MODULE,
      'sw.ts': MODULE,
    });
    expect(publicDefault).toContain('sw.ts');
    const noPublic = orphansOf({
      'vite.config.ts': 'export default { publicDir: false };\n',
      'index.html': '<script type="module" src="/sw.ts"></script>',
      'public/sw.ts': MODULE,
      'sw.ts': MODULE,
    });
    expect(noPublic).not.toContain('sw.ts');
  });

  it('reads the root as a literal or a path from the config folder, and counts nothing for a root it cannot read', () => {
    const page = '<script type="module" src="/main.ts"></script>';
    const literal = orphansOf({
      'vite.config.ts': "export default { root: 'web' };\n",
      'web/index.html': page,
      'web/main.ts': MODULE,
    });
    expect(literal).not.toContain('web/main.ts');
    const fileUrl = orphansOf({
      'vite.config.ts': [
        "import { fileURLToPath } from 'node:url';",
        "export default { root: fileURLToPath(new URL('./client', import.meta.url)) };",
      ].join('\n'),
      'client/index.html': page,
      'client/main.ts': MODULE,
    });
    expect(fileUrl).not.toContain('client/main.ts');
    const computed = orphansOf({
      'vite.config.ts': 'export default { root: process.env.ROOT };\n',
      'index.html': page,
      'main.ts': MODULE,
    });
    expect(computed).toContain('main.ts');
    const partlyComputed = orphansOf({
      'vite.config.ts': [
        "import { resolve } from 'node:path';",
        'export default { root: resolve(__dirname, process.env.APP_DIR) };',
      ].join('\n'),
      'index.html': page,
      'main.ts': MODULE,
    });
    const partlyComputedPublic = orphansOf({
      'vite.config.ts': [
        "import { resolve } from 'node:path';",
        'export default { publicDir: resolve(__dirname, process.env.PUBLIC_DIR) };',
      ].join('\n'),
      'index.html': page,
      'main.ts': MODULE,
      'public/main.ts': MODULE,
    });
    expect(partlyComputed).toContain('main.ts');
    expect(partlyComputedPublic).toContain('main.ts');
  });

  it('counts the HTML build inputs of each config a defineConfig function returns, not other pages', () => {
    const orphans = orphansOf({
      'vite.config.ts': [
        "import { resolve } from 'node:path';",
        "import { defineConfig } from 'vite';",
        'export default defineConfig(({ mode }) => {',
        "  const plugin = { name: 'p', config() { return { root: 'elsewhere' }; } };",
        "  if (mode === 'lib') return { plugins: [plugin], build: { rollupOptions: { input: ['lib/index.html'] } } };",
        '  return {',
        '    build: {',
        '      rollupOptions: {',
        "        input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') },",
        '      },',
        "      rolldownOptions: { input: 'tools/index.html' },",
        '    },',
        '  };',
        '});',
      ].join('\n'),
      'admin/index.html': '<script type="module" src="./main.ts"></script>',
      'admin/main.ts': MODULE,
      'lib/index.html': '<script type="module" src="./main.ts"></script>',
      'lib/main.ts': MODULE,
      'tools/index.html': '<script type="module" src="./main.ts"></script>',
      'tools/main.ts': MODULE,
      'dev/index.html': '<script type="module" src="./main.ts"></script>',
      'dev/main.ts': MODULE,
      'elsewhere/index.html': '<script type="module" src="./main.ts"></script>',
      'elsewhere/main.ts': MODULE,
    });
    expect(orphans).not.toContain('admin/main.ts');
    expect(orphans).not.toContain('lib/main.ts');
    expect(orphans).not.toContain('tools/main.ts');
    expect(orphans).toContain('dev/main.ts');
    expect(orphans).toContain('elsewhere/main.ts');
  });

  it('reads a config held in a const, module.exports or an arrow function, in a project folder below the scanned one', () => {
    const page = '<script type="module" src="/src/main.ts"></script>';
    const orphans = orphansOf({
      'apps/web/vite.config.mts': [
        "import type { UserConfig } from 'vite';",
        'const config = { root: __dirname } satisfies UserConfig;',
        'export default config;',
      ].join('\n'),
      'apps/web/index.html': page,
      'apps/web/src/main.ts': MODULE,
      'apps/legacy/vite.config.cjs': 'module.exports = {};\n',
      'apps/fn/vite.config.js':
        "import { defineConfig } from 'vite';\nexport default defineConfig(() => ({ root: 'site' }));\n",
      'apps/fn/site/index.html': page,
      'apps/fn/site/src/main.ts': MODULE,
      'apps/legacy/index.html': page,
      'apps/legacy/src/main.ts': MODULE,
      'apps/odd/vite.config.ts/notes.md': 'a folder, not a config\n',
      'apps/odd/index.html': page,
      'apps/odd/src/main.ts': MODULE,
      'apps/other/index.html': page,
      'apps/other/src/main.ts': MODULE,
    });
    expect(orphans).not.toContain('apps/web/src/main.ts');
    expect(orphans).not.toContain('apps/legacy/src/main.ts');
    expect(orphans).not.toContain('apps/fn/site/src/main.ts');
    expect(orphans).toContain('apps/other/src/main.ts');
    expect(orphans).toContain('apps/odd/src/main.ts');
  });
});
