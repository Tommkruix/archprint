import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { buildForbiddenImportSpecs } from '../../src/generator/eslint-plugin-emitter.js';
import type { EslintFamilyRule } from '../../src/generator/eslint-family-rules.js';
import { renderEslintPreset } from '../../src/generator/eslint-preset-emitter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'cli-auto');

describe('eslint preset emitter', () => {
  const specs = buildForbiddenImportSpecs(scanRepo(fixture).patterns);
  const family: EslintFamilyRule = {
    name: 'console-isolation',
    message: 'no console',
    ignores: [],
    check: { kind: 'member', object: 'console' },
  };

  it('inlines specs and family rules into one self-contained default-exported array', () => {
    const source = renderEslintPreset(specs, [family]);
    expect(source).toContain('const SPECS =');
    expect(source).toContain('const FAMILY_RULES =');
    expect(source).toContain('no-ui-layer-in-server-entry');
    expect(source).toContain('"console-isolation"');
    expect(source).toContain(
      "export default [{ ignores: ['**/.archprint/**'] }, ...pluginConfigs];",
    );
  });

  it('accepts a custom ignore glob and adopt path', () => {
    const source = renderEslintPreset(specs, [family], {
      ignore: '**/custom/**',
      adoptPath: './custom/eslint.mjs',
    });
    expect(source).toContain("ignores: ['**/custom/**']");
    expect(source).toContain("import archprint from './custom/eslint.mjs';");
  });

  it('needs no runtime file reads (portable): no import statement or readdir/readFile', () => {
    const source = renderEslintPreset(specs, [family]);
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
