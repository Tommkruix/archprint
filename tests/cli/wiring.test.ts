import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGGREGATOR_FILE,
  MANAGED_START,
  eslintConfigHasBlock,
  findEslintConfig,
  hasEslintBlocks,
  importReference,
  outDirHasEslintBlocks,
  snippet,
  unwireEslintContent,
  wireEslintContent,
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
});
