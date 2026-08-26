import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspacePackageMap,
  findWorkspaceRoot,
} from '../../src/scanner/workspace-packages.js';
import { analyzeImports } from '../../src/scanner/file-walker.js';

const monorepo = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'monorepo',
);
const webDir = path.join(monorepo, 'packages', 'web');

describe('buildWorkspacePackageMap', () => {
  it('maps workspace package names to their directories', () => {
    const map = buildWorkspacePackageMap(monorepo);
    expect(map['@acme/db']).toBe(path.join(monorepo, 'packages', 'db'));
    expect(map['@acme/web']).toBe(path.join(monorepo, 'packages', 'web'));
  });

  it('finds the workspace root by walking up from a package', () => {
    expect(findWorkspaceRoot(webDir)).toBe(monorepo);
  });

  const fixture = (name: string): string =>
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name);

  it('expands both a /** glob and an explicit (wildcard-free) workspace path', () => {
    const map = buildWorkspacePackageMap(fixture('ws-glob-explicit'));
    expect(map['@x/a']).toBe(path.join(fixture('ws-glob-explicit'), 'packages', 'a'));
    expect(map['@x/util']).toBe(path.join(fixture('ws-glob-explicit'), 'libs', 'util'));
  });

  it('stops the pnpm packages list at the next top-level yaml key', () => {
    // `catalog:` after the list must end it, not be read as another package glob.
    const map = buildWorkspacePackageMap(fixture('ws-pnpm-nextkey'));
    expect(map['@y/p']).toBe(path.join(fixture('ws-pnpm-nextkey'), 'packages', 'p'));
  });
});

describe('edge classification with workspace-package awareness', () => {
  it('labels a cross-package import as workspace, an alias as alias, and node builtin as external', () => {
    const imports = analyzeImports(webDir, path.join(webDir, 'route.ts'));
    const kindOf = (specifier: string) => imports.find((i) => i.specifier === specifier)?.edgeKind;

    // @acme/db is an INTERNAL workspace boundary (would look "external"/"unresolved" without the map).
    expect(kindOf('@acme/db')).toBe('workspace');
    expect(kindOf('@/local')).toBe('alias');
    // node builtin is NOT internal: external if @types/node is resolvable, else unresolved.
    expect(['external', 'unresolved']).toContain(kindOf('node:fs'));
  });
});
