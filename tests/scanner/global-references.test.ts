import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globalReferences } from '../../src/scanner/global-references.js';
import { writeTree } from '../integration/layer-app.js';

describe('globalReferences', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-globals-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const lines = (source: string, usages: string[], file = 'a.tsx'): string[] => {
    writeTree(root, { [file]: source });
    return globalReferences(path.join(root, file), usages).map(
      (reference) => `${reference.line}:${reference.usage}`,
    );
  };

  it('finds calls, reads and shorthand properties of a global, by line', () => {
    const source = [
      "const response = fetch('/x');",
      'const handler = { fetch };',
      'const key = { [window.name]: 1 };',
      "if (typeof window !== 'undefined') run();",
    ].join('\n');
    expect(lines(source, ['fetch', 'window'])).toEqual([
      '1:fetch',
      '2:fetch',
      '3:window',
      '4:window',
    ]);
  });

  it('ignores member names, object keys, labels and re-exports that share the name', () => {
    const source = [
      "api.fetch('/x');",
      'const options = { fetch: 1 };',
      'class Client { fetch() {} }',
      'fetch: for (;;) { break fetch; }',
      "export { fetch } from './other';",
    ].join('\n');
    expect(lines(source, ['fetch'])).toEqual([]);
  });

  it('leaves out a read that resolves to an import or declaration of the same name', () => {
    expect(lines("import { fetch } from 'undici';\nfetch('/x');\n", ['fetch'])).toEqual([]);
    expect(lines("fetch('/x');\nconst { fetch } = deps;\n", ['fetch'])).toEqual([]);
  });

  it('resolves each read through its own scopes, so a parameter or block binding shadows only there', () => {
    const source = [
      "function go(fetch: F) { return fetch('/x'); }",
      "const top = fetch('/y');",
      '{ const window = 1; use(window); }',
      'use(window);',
    ].join('\n');
    expect(lines(source, ['fetch', 'window'])).toEqual(['2:fetch', '4:window']);
  });

  it('does not let a type or interface of the same name hide the global value', () => {
    const source = [
      'type fetch = number;',
      'interface localStorage {}',
      'use(fetch, localStorage);',
    ].join('\n');
    expect(lines(source, ['fetch', 'localStorage'])).toEqual(['3:fetch', '3:localStorage']);
  });

  it('reads the script block of a Vue file', () => {
    const vue =
      '<template><div /></template>\n<script lang="ts">\nconst a = fetch(\'/x\');\n</script>\n';
    expect(lines(vue, ['fetch'], 'card.vue')).toHaveLength(1);
  });

  it('counts a value read in a typeof type query and a class extends, not other type positions', () => {
    const source = [
      'const options: Intl.DateTimeFormatOptions = {};',
      'type Fetch = typeof fetch;',
      'class Page extends window.HTMLElement implements Window {}',
      'const format = new Intl.DateTimeFormat();',
    ].join('\n');
    expect(lines(source, ['Intl', 'fetch', 'window'])).toEqual(['2:fetch', '3:window', '4:Intl']);
  });

  it('matches a member usage only on that member, read with a dot', () => {
    const source = [
      'const a = process.env.API_URL;',
      'const b = process.argv;',
      "const c = process['env'];",
      'const d = process?.env;',
    ].join('\n');
    expect(lines(source, ['process.env'])).toEqual(['1:process.env', '4:process.env']);
  });

  it('counts a local export of the global but not a lowercase JSX tag of the same name', () => {
    const source = [
      'export { fetch as request };',
      'const tag = <window />;',
      "const button = <button onClick={() => fetch('/x')} />;",
    ].join('\n');
    expect(lines(source, ['fetch', 'window'])).toEqual(['1:fetch', '3:fetch']);
  });
});
