import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/index.js';
import { writeTree } from '../integration/layer-app.js';

const SOURCE = 'export const value = 1;\n';
const json = (value: unknown): string => JSON.stringify(value);

describe('orphans: JavaScript, .mts and .cts files reference source files without being orphans', () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-orphans-js-')));
    writeTree(repo, {
      'tsconfig.json': json({ compilerOptions: { allowJs: true } }),
      'src/index.js': [
        "import { a } from './from-js';",
        'export const App = () => <p>Press ` to open {a}</p>;',
        "export const later = () => import('./lazy');",
        'export const Help = () => <p>Press ` again</p>;',
        '',
      ].join('\n'),
      'src/view.jsx': [
        'export const View = () => <p>Press ` to open</p>;',
        "import { b } from './from-jsx';",
        'export const Help = () => <p>{b} ` again</p>;',
        '',
      ].join('\n'),
      'src/server.mjs': "import { c } from './from-mjs.js';\nexport const d = c;\n",
      'src/legacy.cjs': "const { e } = require('./from-cjs');\nmodule.exports = e;\n",
      'src/format.test.js': "import { f } from './format';\ntest('f', () => f);\n",
      'src/Badge.test.jsx': "import { Badge } from './Badge';\ntest('b', () => <Badge />);\n",
      'src/Badge.tsx': SOURCE,
      'src/boot.mts': "import { g } from './from-mts.js';\nexport const h = g;\n",
      'src/tool.cts': "const { i } = require('./from-cts');\nexport = i;\n",
      'src/check.test.mts': "import { j } from './checked.js';\ntest('j', () => j);\n",
      'src/types.d.mts': "import type { k } from './declared.js';\nexport type K = typeof k;\n",
      'src/from-mts.ts': SOURCE,
      'src/from-cts.ts': SOURCE,
      'src/checked.ts': SOURCE,
      'src/declared.ts': SOURCE,
      'src/from-js.ts': SOURCE,
      'src/lazy.ts': SOURCE,
      'src/from-jsx.tsx': SOURCE,
      'src/from-mjs.ts': SOURCE,
      'src/from-cjs.ts': SOURCE,
      'src/format.ts': SOURCE,
      'src/unused.ts': SOURCE,
      'src/unused.js': SOURCE,
      'tools/vitest.config.mjs': "export default { test: { setupFiles: ['./setup.ts'] } };\n",
      'tools/setup.ts': SOURCE,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('counts imports from .js, .jsx, .mjs, .cjs, .mts and .cts files, JSX included, not declarations', () => {
    expect(detectOrphans(repo).orphans).toEqual(['src/declared.ts', 'src/unused.ts']);
  });

  it('lists a file only a JavaScript or .mts test imports as test-only', () => {
    expect(detectOrphans(repo).testOnly).toEqual([
      'src/Badge.tsx',
      'src/checked.ts',
      'src/format.ts',
    ]);
  });
});

describe('orphans: Astro components reference source files', () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-orphans-astro-')));
    writeTree(repo, {
      'tsconfig.json': json({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      'src/pages/index.astro': [
        '---',
        "import { render } from '../lib/renderers.js';",
        'const html = render();',
        '---',
        "<p>import { text } from '../lib/in-template';</p>",
        '<script>',
        "  import { observe } from '@/lib/observer';",
        '  observe();',
        '</script>',
        '',
      ].join('\n'),
      'src/pages/plain.astro': [
        '<h1>No frontmatter</h1>',
        '---',
        "import { hr } from '../lib/after-rule';",
        '---',
        '',
      ].join('\n'),
      'src/lib/renderers.ts': SOURCE,
      'src/lib/observer.ts': SOURCE,
      'src/lib/in-template.ts': SOURCE,
      'src/lib/after-rule.ts': SOURCE,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('counts imports in the frontmatter and script blocks, not text in the template', () => {
    expect(detectOrphans(repo).orphans).toEqual([
      'src/lib/after-rule.ts',
      'src/lib/in-template.ts',
    ]);
  });
});
