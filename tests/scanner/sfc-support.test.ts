import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImportAnalyzer, walkRepo } from '../../src/scanner/file-walker.js';
import { resolveFirstPartyImport } from '../../src/scanner/resolve-import.js';

// Vue/Svelte single-file components are not valid TypeScript; their imports live in the <script> block.
// Lock in that they are walked, classified as components, and have their imports and targets resolved.
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
});
