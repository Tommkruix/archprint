import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGGREGATOR_FILE,
  DC_AGGREGATE_FILE,
  MANAGED_START,
  WIRING_TOOLS,
  dependencyCruiserJsonWired,
  dependencyCruiserSnippet,
  eslintConfigHasBlock,
  findEslintConfig,
  hasDependencyCruiserBlocks,
  hasEslintBlocks,
  hasEslintOutputs,
  importReference,
  outDirHasDependencyCruiserBlocks,
  outDirHasEslintBlocks,
  outDirHasEslintOutputs,
  snippet,
  unwireDependencyCruiserJson,
  unwireEslintContent,
  wireDependencyCruiserJson,
  wireEslintContent,
  writeDependencyCruiserAggregate,
  writeEslintAggregator,
} from '../../src/cli/wiring.js';

describe('wiring transforms', () => {
  const base = "import js from '@eslint/js';\n\nexport default [\n  js.configs.recommended,\n];\n";

  it('inserts a managed import block and a spread into an array export', () => {
    const result = wireEslintContent(base, './archprint-rules/eslint.archprint.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain(MANAGED_START);
    expect(result.content).toContain(
      "import archprintRules from './archprint-rules/eslint.archprint.mjs';",
    );
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

  it('supports the module.exports = [ ] form', () => {
    const result = wireEslintContent('module.exports = [\n];\n', './x.mjs');
    expect(result.changed).toBe(true);
  });

  it('keeps a single-line empty array valid (the closer is not swallowed by the comment)', () => {
    const result = wireEslintContent('export default [];\n', './x.mjs');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('\n];');
    expect(result.content).not.toMatch(/managed\];/);
  });

  it('unwire restores the original content exactly (round-trip)', () => {
    const wired = wireEslintContent(base, './x.mjs').content!;
    expect(unwireEslintContent(wired)).toBe(base);
  });

  it('importReference always yields a relative specifier', () => {
    expect(importReference('/a/b', '/a/b/archprint-rules/eslint.archprint.mjs')).toBe(
      './archprint-rules/eslint.archprint.mjs',
    );
  });

  it('hasEslintBlocks detects eslint json blocks among paths', () => {
    expect(hasEslintBlocks(['/o/eslint.console-isolation.archprint.json'])).toBe(true);
    expect(hasEslintBlocks(['/o/dependency-cruiser.archprint.json'])).toBe(false);
  });

  it('hasEslintOutputs also counts the generated plugin', () => {
    expect(hasEslintOutputs(['/o/eslint-plugin.archprint.mjs'])).toBe(true);
    expect(hasEslintOutputs(['/o/eslint.console-isolation.archprint.json'])).toBe(true);
    expect(hasEslintOutputs(['/o/dependency-cruiser.archprint.json'])).toBe(false);
  });

  it('snippet renders a paste-able managed block', () => {
    expect(snippet('./x.mjs')).toContain(MANAGED_START);
    expect(snippet('./x.mjs')).toContain('...archprintRules,');
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

  it('writeEslintAggregator writes the aggregator file', () => {
    const file = writeEslintAggregator(dir);
    expect(existsSync(file)).toBe(true);
    expect(path.basename(file)).toBe(AGGREGATOR_FILE);
  });

  it('findEslintConfig finds a flat config and returns null otherwise', () => {
    expect(findEslintConfig(dir)).toBeNull();
    const config = path.join(dir, 'eslint.config.mjs');
    writeFileSync(config, 'export default [];\n');
    expect(findEslintConfig(dir)).toBe(config);
  });

  it('outDirHasEslintBlocks and eslintConfigHasBlock reflect on-disk state', () => {
    expect(outDirHasEslintBlocks(dir)).toBe(false);
    writeFileSync(path.join(dir, 'eslint.console-isolation.archprint.json'), '{}');
    expect(outDirHasEslintBlocks(dir)).toBe(true);

    const config = path.join(dir, 'eslint.config.mjs');
    writeFileSync(config, 'export default [];\n');
    expect(eslintConfigHasBlock(config)).toBe(false);
    writeFileSync(config, `${MANAGED_START}\nexport default [];\n`);
    expect(eslintConfigHasBlock(config)).toBe(true);
  });

  it('outDirHasEslintOutputs is true when only the generated plugin is present', () => {
    expect(outDirHasEslintOutputs(dir)).toBe(false);
    writeFileSync(path.join(dir, 'eslint-plugin.archprint.mjs'), 'export default [];\n');
    expect(outDirHasEslintOutputs(dir)).toBe(true);
  });
});

describe('dependency-cruiser wiring', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-dc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds a managed extends and unwire restores it (round-trip)', () => {
    const base = '{\n  "forbidden": [],\n  "options": {}\n}\n';
    const wired = wireDependencyCruiserJson(
      base,
      './archprint-rules/dependency-cruiser.all.archprint.json',
    );
    expect(wired.changed).toBe(true);
    expect(dependencyCruiserJsonWired(wired.content!)).toBe(true);
    expect(JSON.parse(unwireDependencyCruiserJson(wired.content!))).toEqual({
      forbidden: [],
      options: {},
    });
  });

  it('appends to an existing extends array and is idempotent', () => {
    const withExtends = '{\n  "extends": "some-preset"\n}\n';
    const once = wireDependencyCruiserJson(
      withExtends,
      './x/dependency-cruiser.all.archprint.json',
    );
    expect(JSON.parse(once.content!).extends).toEqual([
      'some-preset',
      './x/dependency-cruiser.all.archprint.json',
    ]);
    const twice = wireDependencyCruiserJson(
      once.content!,
      './x/dependency-cruiser.all.archprint.json',
    );
    expect(twice.reason).toBe('already-wired');
  });

  it('unwire keeps a user extends and drops only the archprint one', () => {
    const content = JSON.stringify({
      extends: ['some-preset', './archprint-rules/dependency-cruiser.all.archprint.json'],
    });
    expect(JSON.parse(unwireDependencyCruiserJson(content))).toEqual({ extends: 'some-preset' });
  });

  it('reports unparseable config instead of throwing', () => {
    expect(wireDependencyCruiserJson('not json', './x.json').reason).toBe('unparseable');
    expect(dependencyCruiserJsonWired('not json')).toBe(false);
  });

  it('aggregate merges the forbidden arrays and excludes itself', () => {
    writeFileSync(
      path.join(dir, 'dependency-cruiser.a.archprint.json'),
      JSON.stringify({ forbidden: [{ name: 'a' }] }),
    );
    writeFileSync(
      path.join(dir, 'dependency-cruiser.b.archprint.json'),
      JSON.stringify({ forbidden: [{ name: 'b' }] }),
    );
    const file = writeDependencyCruiserAggregate(dir);
    expect(path.basename(file)).toBe(DC_AGGREGATE_FILE);
    const merged = JSON.parse(readFileSync(file, 'utf8')) as { forbidden: { name: string }[] };
    expect(merged.forbidden.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });

  it('hasDependencyCruiserBlocks and outDirHasDependencyCruiserBlocks detect blocks', () => {
    expect(hasDependencyCruiserBlocks(['/o/dependency-cruiser.phantom-deps.archprint.json'])).toBe(
      true,
    );
    expect(hasDependencyCruiserBlocks(['/o/dependency-cruiser.all.archprint.json'])).toBe(false);
    expect(hasDependencyCruiserBlocks(['/o/eslint.console-isolation.archprint.json'])).toBe(false);
    expect(outDirHasDependencyCruiserBlocks(dir)).toBe(false);
    writeFileSync(path.join(dir, 'dependency-cruiser.phantom-deps.archprint.json'), '{}');
    expect(outDirHasDependencyCruiserBlocks(dir)).toBe(true);
  });

  it('dependencyCruiserSnippet renders a paste-able extends block', () => {
    expect(dependencyCruiserSnippet('./x.json')).toContain('"extends": "./x.json"');
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
