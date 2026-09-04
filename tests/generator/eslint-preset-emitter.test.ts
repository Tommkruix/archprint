import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { buildForbiddenImportSpecs } from '../../src/generator/eslint-plugin-emitter.js';
import { renderEslintPreset } from '../../src/generator/eslint-preset-emitter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'cli-auto');

describe('eslint preset emitter', () => {
  const specs = buildForbiddenImportSpecs(scanRepo(fixture).patterns);
  const block = { rules: { 'no-console': 'error' } };

  it('inlines specs and blocks into one self-contained default-exported array', () => {
    const source = renderEslintPreset(specs, [block]);
    expect(source).toContain('const SPECS =');
    expect(source).toContain('const BLOCKS =');
    expect(source).toContain('no-ui-layer-in-server-entry');
    expect(source).toContain('no-console');
    expect(source).toContain('export default [...BLOCKS, ...pluginConfigs];');
  });

  it('needs no runtime file reads (portable): no import statement or readdir/readFile', () => {
    const source = renderEslintPreset(specs, [block]);
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toContain('readdirSync');
    expect(source).not.toContain('readFileSync');
  });

  it('reuses the plugin rule runtime so enforcement is identical', () => {
    const source = renderEslintPreset(specs, []);
    expect(source).toContain("node.importKind === 'type'");
    expect(source).toContain('spec.ignore.some');
  });
});
