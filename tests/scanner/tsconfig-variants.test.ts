import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { hasTsConfig } from '../../src/cli/scan.js';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { discoverAppDirs } from '../../src/scanner/app-dirs.js';
import { analyzeImports } from '../../src/scanner/file-walker.js';
import { buildWorkspaceMap, owningConfigPath } from '../../src/scanner/workspace-resolver.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const variants = path.join(here, '..', 'fixtures', 'tsconfig-variants');

const config = (paths: Record<string, string[]>, include: string[] = ['**/*']): string =>
  JSON.stringify({ compilerOptions: { paths }, include });

describe('folders configured only by tsconfig.*.json files', () => {
  const temps: string[] = [];
  const scratch = (files: Record<string, string>): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-variants-'));
    temps.push(dir);
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), body);
    }
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads the aliases the variants agree on, and leaves out one they map differently', () => {
    const map = buildWorkspaceMap(variants);
    expect(map['@app']).toBe(path.resolve(variants, 'src'));
    expect(map['#dynamic']).toBeUndefined();
  });

  it('sees imports through those aliases, so their targets are not orphans', () => {
    const { orphans } = detectOrphans(variants);
    expect(orphans).not.toContain('src/components/button.ts');
    expect(orphans).toContain('src/lib/unused.ts');
  });

  it('resolves a file in deep mode with the first variant, by name, that includes it', () => {
    const leaves = (file: string, specifier: string): string[] =>
      analyzeImports(variants, path.join(variants, file))
        .filter((imp) => imp.specifier === specifier)
        .flatMap((imp) => imp.valueLeafPaths)
        .map((leaf) => path.relative(variants, leaf).split(path.sep).join('/'));
    expect(leaves('src/main.ts', '@app/components/button')).toEqual(['src/components/button.ts']);
    expect(leaves('src/api.ts', '#dynamic/router')).toEqual(['server/router.ts']);
  });

  it('uses only tsconfig.json when a folder has one', () => {
    const dir = scratch({
      'tsconfig.json': config({ '@app/*': ['./lib/*'] }),
      'tsconfig.build.json': config({ '@app/*': ['./src/*'], '@build/*': ['./build/*'] }),
      'lib/a.ts': 'export const a = 1;',
    });
    const map = buildWorkspaceMap(dir);
    expect(map['@app']).toBe(path.resolve(dir, 'lib'));
    expect(map['@build']).toBeUndefined();
  });

  it('reads no variant beside a tsconfig.base.json, which other configs extend', () => {
    const dir = scratch({
      'tsconfig.base.json': config({ '@base/*': ['./base/*'] }),
      'tsconfig.release.json': config({ '@release/*': ['./release/*'] }),
      'a.ts': 'export const a = 1;',
    });
    expect(buildWorkspaceMap(dir)).toEqual({});
    expect(owningConfigPath(dir)(path.join(dir, 'a.ts'))).toBe(path.join(dir, 'tsconfig.json'));
  });

  it('ignores a variant whose files all belong to a nested tsconfig.json', () => {
    const dir = scratch({
      'tsconfig.eslint.json': config({ '@lint/*': ['./web/*'] }, ['web']),
      'web/tsconfig.json': '{}',
      'web/a.ts': 'export const a = 1;',
      'tools.ts': 'export const t = 1;',
    });
    expect(buildWorkspaceMap(dir)['@lint']).toBeUndefined();
    expect(hasTsConfig(dir)).toBe(false);
    expect(discoverAppDirs(dir, 1)).toEqual([path.join(dir, 'web')]);
  });

  it('counts a variant-only folder as an app dir unless a tsconfig.json or tsconfig.base.json sits above it', () => {
    const variantRoot = scratch({
      'tsconfig.web.json': config({}),
      'a.ts': 'export const a = 1;',
      'tests/tsconfig.test.json': config({}),
      'tests/a.test.ts': 'export const t = 1;',
    });
    expect(discoverAppDirs(variantRoot, 1)).toEqual([variantRoot, path.join(variantRoot, 'tests')]);

    const standardRoot = scratch({
      'tsconfig.json': '{}',
      'a.ts': 'export const a = 1;',
      'server/tsconfig.server.json': config({}),
      'server/a.ts': 'export const s = 1;',
    });
    expect(discoverAppDirs(standardRoot, 1)).toEqual([standardRoot]);
  });

  it('accepts a folder with tsconfig.json or a variant as an app to scan, and not one with only tsconfig.base.json', () => {
    expect(hasTsConfig(scratch({ 'tsconfig.json': '{}' }))).toBe(true);
    expect(hasTsConfig(variants)).toBe(true);
    expect(hasTsConfig(scratch({ 'tsconfig.base.json': '{}', 'tsconfig.lib.json': '{}' }))).toBe(
      false,
    );
  });
});
