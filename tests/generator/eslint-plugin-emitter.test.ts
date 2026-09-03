import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import {
  buildForbiddenImportSpecs,
  renderEslintPluginSource,
} from '../../src/generator/eslint-plugin-emitter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'cli-auto');

describe('eslint plugin emitter', () => {
  const specs = buildForbiddenImportSpecs(scanRepo(fixture).patterns);

  it('builds a spec per AUTO forbidden-import pattern with resolved roles and markers', () => {
    expect(specs.length).toBeGreaterThan(0);
    const ui = specs.find((s) => s.name === 'no-ui-layer-in-server-entry');
    expect(ui).toBeDefined();
    expect(ui!.roles.length).toBeGreaterThan(0);
    expect(ui!.markers.length).toBeGreaterThan(0);
    expect(ui!.message.length).toBeGreaterThan(0);
  });

  it('renders a self-contained plugin module that registers each rule', () => {
    const source = renderEslintPluginSource(specs);
    expect(source).toContain('export const plugin');
    expect(source).toContain('export default');
    expect(source).toContain("'archprint/' + spec.name");
    expect(source).toContain('no-ui-layer-in-server-entry');
    expect(source).toContain("node.importKind === 'type'");
  });

  it('returns no specs when there are no AUTO patterns', () => {
    expect(buildForbiddenImportSpecs([])).toEqual([]);
  });

  it('grandfathers the known exception files (deduped and sorted)', () => {
    const pattern = {
      config: {
        id: 'AP-X',
        name: 'no-x',
        description: 'no x',
        roles: ['ROUTE_HANDLER'],
        forbidden: [/@\/x/],
      },
      result: {
        gate: { status: 'AUTO' },
        violations: [
          { file: 'b.ts', specifier: '@/x', leaf: 'x' },
          { file: 'a.ts', specifier: '@/x', leaf: 'x' },
          { file: 'a.ts', specifier: '@/x', leaf: 'x' },
        ],
      },
    } as unknown as Parameters<typeof buildForbiddenImportSpecs>[0][number];
    const [spec] = buildForbiddenImportSpecs([pattern]);
    expect(spec!.ignore).toEqual(['a.ts', 'b.ts']);
    expect(renderEslintPluginSource([spec!])).toContain('spec.ignore.some');
  });
});
