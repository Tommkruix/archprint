import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MANAGED_START,
  WIRING_TOOLS,
  dependencyCruiserJsonWired,
  dependencyCruiserSnippet,
  findEslintConfig,
  importReference,
  rewriteEslintReference,
  snippet,
  unwireDependencyCruiserJson,
  unwireEslintContent,
  wireDependencyCruiserJson,
  wireEslintContent,
} from '../../src/cli/wiring.js';

describe('wiring transforms', () => {
  const base = "import js from '@eslint/js';\n\nexport default [\n  js.configs.recommended,\n];\n";

  it('inserts a managed import block and a spread into an array export', () => {
    const result = wireEslintContent(base, './.archprint/eslint.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain(MANAGED_START);
    expect(result.content).toContain("import archprintRules from './.archprint/eslint.mjs';");
    expect(result.content).toContain('...archprintRules,');
  });

  it('is idempotent: a second wire is a no-op', () => {
    const once = wireEslintContent(base, './x.mjs').content!;
    const twice = wireEslintContent(once, './x.mjs');
    expect(twice.changed).toBe(false);
    expect(twice.reason).toBe('already-wired');
  });

  it('reports when there is no array-form default export', () => {
    const result = wireEslintContent('export default someConfig;\n', './x.mjs');
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('no-array-export');
  });

  it('wires the indirect Next.js shape (const config = [...]; export default config) and round-trips', () => {
    const src = "import next from 'x';\nconst config = [\n  ...next,\n];\nexport default config;\n";
    const result = wireEslintContent(src, './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('const config = [\n  ...archprintRules,');
    expect(unwireEslintContent(result.content!)).toBe(src);
  });

  it('resolves an identifier export to a defineConfig([...]) declaration', () => {
    const src = 'const config = defineConfig([\n  base,\n]);\nexport default config;\n';
    const result = wireEslintContent(src, './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('defineConfig([\n  ...archprintRules,');
    expect(unwireEslintContent(result.content!)).toBe(src);
  });

  it('resolves a let-declared config array', () => {
    const result = wireEslintContent('let config = [\n];\nexport default config;\n', './x.mjs');
    expect(result.changed).toBe(true);
  });

  it('is not fooled by "export default" inside a string literal (real-world Next config)', () => {
    const src =
      "const config = [\n  { rules: { m: 'export default it at the end of the file' } },\n];\nexport default config;\n";
    const result = wireEslintContent(src, './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('const config = [\n  ...archprintRules,');
    expect(unwireEslintContent(result.content!)).toBe(src);
  });

  it('bails on an unrecognized factory call, whatever its arguments', () => {
    for (const src of [
      'export default loadConfig();\n',
      'export default loadConfig(base);\n',
      'export default loadConfig([]);\n',
    ]) {
      const result = wireEslintContent(src, './x.mjs');
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('no-array-export');
    }
  });

  it('bails instead of splicing into a non-array call the identifier resolves to', () => {
    const result = wireEslintContent(
      'const config = loadConfig();\nexport default config;\n',
      './x.mjs',
    );
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('no-array-export');
  });

  it('supports the module.exports = [ ] form', () => {
    const result = wireEslintContent('module.exports = [\n];\n', './x.mjs');
    expect(result.changed).toBe(true);
  });

  it('wires a tseslint.config(...) call as the first spread arg and round-trips', () => {
    const src = 'export default tseslint.config(\n  base,\n  extra,\n);\n';
    const result = wireEslintContent(src, './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('tseslint.config(\n  ...archprintRules,');
    expect(unwireEslintContent(result.content!)).toBe(src);
  });

  it('wires an array inside a defineConfig([...]) call and round-trips', () => {
    const src = 'export default defineConfig([\n  base,\n]);\n';
    const result = wireEslintContent(src, './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('defineConfig([\n  ...archprintRules,');
    expect(unwireEslintContent(result.content!)).toBe(src);
  });

  it('keeps a single-line empty array valid (the closer is not swallowed by the comment)', () => {
    const result = wireEslintContent('export default [];\n', './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      'export default [...archprintRules /* archprint:managed */, ];',
    );
    expect(unwireEslintContent(result.content!)).toBe('export default [];\n');
  });

  it('round-trips a config whose array starts on the same line as its first entry', () => {
    const src =
      "import tseslint from 'typescript-eslint';\n\nexport default [{ ignores: ['dist/'] }, ...tseslint.configs.recommended];\n";
    const result = wireEslintContent(src, './x.mjs');
    expect(result.content).toContain(
      'export default [...archprintRules /* archprint:managed */, { ignores',
    );
    expect(unwireEslintContent(result.content!)).toBe(src);
  });

  it('unwire restores the original content exactly (round-trip)', () => {
    const wired = wireEslintContent(base, './x.mjs').content!;
    expect(unwireEslintContent(wired)).toBe(base);
  });

  it('importReference yields a relative specifier, including for a dot-directory', () => {
    expect(importReference('/a/b', '/a/b/archprint-rules/eslint.mjs')).toBe(
      './archprint-rules/eslint.mjs',
    );
    expect(importReference('/a/b', '/a/b/.archprint/eslint.mjs')).toBe('./.archprint/eslint.mjs');
  });

  it('snippet renders a paste-able managed block', () => {
    expect(snippet('./x.mjs')).toContain(MANAGED_START);
    expect(snippet('./x.mjs')).toContain('...archprintRules,');
  });

  it('rewriteEslintReference retargets the managed import for any quote style', () => {
    for (const q of ["'", '"', '`']) {
      const src = `import archprintRules from ${q}./archprint-rules/eslint.archprint.mjs${q};`;
      expect(rewriteEslintReference(src, './.archprint/eslint.mjs')).toBe(
        `import archprintRules from ${q}./.archprint/eslint.mjs${q};`,
      );
    }
  });
});

describe('dependency-cruiser wiring', () => {
  it('adds a managed extends and unwire restores it (round-trip)', () => {
    const base = '{\n  "forbidden": [],\n  "options": {}\n}\n';
    const wired = wireDependencyCruiserJson(base, './.archprint/dependency-cruiser.json');
    expect(wired.changed).toBe(true);
    expect(dependencyCruiserJsonWired(wired.content!)).toBe(true);
    expect(JSON.parse(unwireDependencyCruiserJson(wired.content!))).toEqual({
      forbidden: [],
      options: {},
    });
  });

  it('appends to an existing extends array and is idempotent', () => {
    const withExtends = '{\n  "extends": "some-preset"\n}\n';
    const ref = './.archprint/dependency-cruiser.json';
    const once = wireDependencyCruiserJson(withExtends, ref);
    expect(JSON.parse(once.content!).extends).toEqual(['some-preset', ref]);
    const twice = wireDependencyCruiserJson(once.content!, ref);
    expect(twice.reason).toBe('already-wired');
  });

  it('retargets a stale archprint extends instead of appending a duplicate', () => {
    const stale = JSON.stringify({
      extends: ['./archprint-rules/dependency-cruiser.all.archprint.json'],
    });
    const ref = './.archprint/dependency-cruiser.json';
    const result = wireDependencyCruiserJson(stale, ref);
    expect(result.changed).toBe(true);
    expect(JSON.parse(result.content!).extends).toBe(ref);
  });

  it('collapses a config holding both a stale and the new archprint extends to one', () => {
    const ref = './.archprint/dependency-cruiser.json';
    const content = JSON.stringify({
      extends: ['./archprint-rules/dependency-cruiser.all.archprint.json', ref],
    });
    const result = wireDependencyCruiserJson(content, ref);
    expect(result.changed).toBe(true);
    expect(JSON.parse(result.content!).extends).toBe(ref);
  });

  it('unwire keeps a user extends and drops only the archprint one', () => {
    const content = JSON.stringify({
      extends: ['some-preset', './.archprint/dependency-cruiser.json'],
    });
    expect(JSON.parse(unwireDependencyCruiserJson(content))).toEqual({ extends: 'some-preset' });
  });

  it('reports unparseable config instead of throwing', () => {
    expect(wireDependencyCruiserJson('not json', './x.json').reason).toBe('unparseable');
    expect(dependencyCruiserJsonWired('not json')).toBe(false);
  });

  it('dependencyCruiserSnippet renders a paste-able extends block', () => {
    expect(dependencyCruiserSnippet('./x.json')).toContain('"extends": "./x.json"');
  });
});

describe('wiring filesystem helpers', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-wiring-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('findEslintConfig finds a flat config and returns null otherwise', () => {
    expect(findEslintConfig(dir)).toBeNull();
    const config = path.join(dir, 'eslint.config.mjs');
    writeFileSync(config, 'export default [];\n');
    expect(findEslintConfig(dir)).toBe(config);
  });

  it('the eslint tool reports outputs once the single rules file exists', () => {
    const eslint = WIRING_TOOLS.find((tool) => tool.name === 'eslint')!;
    expect(eslint.hasOutputs(dir)).toBe(false);
    writeFileSync(path.join(dir, 'eslint.mjs'), 'export default [];\n');
    expect(eslint.hasOutputs(dir)).toBe(true);
  });

  it('the dependency-cruiser tool reports outputs once the single rules file exists', () => {
    const dc = WIRING_TOOLS.find((tool) => tool.name === 'dependency-cruiser')!;
    expect(dc.hasOutputs(dir)).toBe(false);
    writeFileSync(path.join(dir, 'dependency-cruiser.json'), '{}');
    expect(dc.hasOutputs(dir)).toBe(true);
  });
});

describe('wiring registry', () => {
  it('exposes eslint and dependency-cruiser tools', () => {
    expect(WIRING_TOOLS.map((tool) => tool.name).sort()).toEqual(['dependency-cruiser', 'eslint']);
  });

  it('dependency-cruiser only auto-edits .json configs', () => {
    const dc = WIRING_TOOLS.find((tool) => tool.name === 'dependency-cruiser')!;
    expect(dc.canEdit('/x/.dependency-cruiser.json')).toBe(true);
    expect(dc.canEdit('/x/.dependency-cruiser.js')).toBe(false);
  });
});
