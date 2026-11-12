import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createImportAnalyzer,
  importLocations,
  moduleReferences,
  readSource,
  walkRepo,
} from '../../src/scanner/file-walker.js';
import { resolveFirstPartyImport } from '../../src/scanner/resolve-import.js';

describe('single-file component support', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-sfc-'));
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));
    writeFileSync(path.join(dir, 'src', 'Widget.vue'), '<template><div /></template>\n');
    writeFileSync(
      path.join(dir, 'src', 'App.vue'),
      [
        '<template><Widget /></template>',
        '<script setup lang="ts">',
        "import Widget from './Widget.vue';",
        "import { load } from './data';",
        '</script>',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(dir, 'src', 'Page.svelte'),
      ['<script lang="ts">', "  import { store } from './store';", '</script>', '<h1 />', ''].join(
        '\n',
      ),
    );
    writeFileSync(path.join(dir, 'src', 'data.ts'), 'export const load = () => 1;\n');
    writeFileSync(path.join(dir, 'src', 'store.ts'), 'export const store = 1;\n');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('walks .vue/.svelte files and classifies them as components', () => {
    const byPath = new Map(walkRepo(dir).map((file) => [file.relativePath, file.role]));
    expect(byPath.get('src/App.vue')).toBe('COMPONENT');
    expect(byPath.get('src/Page.svelte')).toBe('COMPONENT');
  });

  it('extracts imports from the SFC script block (fast mode)', () => {
    const analyze = createImportAnalyzer(dir, { resolve: false });
    const specifiers = analyze(path.join(dir, 'src', 'App.vue')).map((imp) => imp.specifier);
    expect(specifiers).toEqual(['./Widget.vue', './data']);
    const svelte = analyze(path.join(dir, 'src', 'Page.svelte')).map((imp) => imp.specifier);
    expect(svelte).toEqual(['./store']);
  });

  it('classifies first-party SFC edges even in deep mode', () => {
    const analyze = createImportAnalyzer(dir, { resolve: true });
    const edges = new Map(
      analyze(path.join(dir, 'src', 'App.vue')).map((imp) => [imp.specifier, imp.edgeKind]),
    );
    expect(edges.get('./Widget.vue')).toBe('relative');
    expect(edges.get('./data')).toBe('relative');
  });

  it('resolves an import that targets an SFC file', () => {
    const from = path.join(dir, 'src', 'App.vue');
    expect(resolveFirstPartyImport('./Widget.vue', from, [])).toBe(
      path.join(dir, 'src', 'Widget.vue'),
    );
    expect(resolveFirstPartyImport('./Page', from, [])).toBe(path.join(dir, 'src', 'Page.svelte'));
  });

  it('reports import lines as they are in the component file, not in its script block', () => {
    expect(importLocations(path.join(dir, 'src', 'App.vue'))).toEqual([
      { specifier: './Widget.vue', line: 3 },
      { specifier: './data', line: 4 },
    ]);
    expect(importLocations(path.join(dir, 'src', 'Page.svelte'))).toEqual([
      { specifier: './store', line: 2 },
    ]);
  });
});

describe('Astro component support', () => {
  let dir: string;
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  const astro = (name: string, lines: string[]): string => {
    const file = path.join(dir, name);
    writeFileSync(file, lines.join('\n'));
    return file;
  };
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-astro-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses the frontmatter and script blocks in place, the fences and template blanked', () => {
    const file = astro('Page.astro', [
      '---',
      "import { a } from './a';",
      '---',
      "<p>import x from './x';</p>",
      '<script>',
      "import { b } from './b';",
      '</script>',
      '',
    ]);
    expect(readSource(file).source).toBe(
      [
        blank('---'),
        "import { a } from './a';",
        blank('---'),
        blank("<p>import x from './x';</p>"),
        blank('<script>'),
        "import { b } from './b';",
        blank('</script>'),
        '',
      ].join('\n'),
    );
  });

  it('parses the script blocks of a component without frontmatter', () => {
    const file = astro('Plain.astro', [
      '<h1>Plain</h1>',
      '<script>',
      "import { c } from './c';",
      '</script>',
      '',
    ]);
    expect(moduleReferences(file)).toEqual(['./c']);
  });
});
