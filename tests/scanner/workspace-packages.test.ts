import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkspacePackageMap,
  findWorkspaceRoot,
  findWorkspaceRoots,
} from '../../src/scanner/workspace-packages.js';
import { analyzeImports } from '../../src/scanner/file-walker.js';
import { writeTree } from '../integration/layer-app.js';

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
    const map = buildWorkspacePackageMap(fixture('ws-pnpm-nextkey'));
    expect(map['@y/p']).toBe(path.join(fixture('ws-pnpm-nextkey'), 'packages', 'p'));
  });
});

describe('findWorkspaceRoots', () => {
  let root: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-ws-roots-')));
    writeTree(root, {
      'go.mod': 'module example.com/svc\n',
      '.gitignore': 'generated/\n',
      'web/pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n',
      'web/apps/portal/package.json': JSON.stringify({ name: '@acme/portal' }),
      'examples/demo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'tools/pnpm-workspace.yaml': 'packages:\n  - "lint"\n',
      'node_modules/dep/pnpm-workspace.yaml': 'packages:\n  - "x"\n',
      'generated/pnpm-workspace.yaml': 'packages:\n  - "y"\n',
    });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds the workspaces nested below a root that is not one, shallowest first, skipping ignored folders', () => {
    expect(findWorkspaceRoots(root).map((dir) => path.relative(root, dir))).toEqual([
      'tools',
      'web',
      path.join('examples', 'demo'),
    ]);
  });

  it('puts the workspace at or above the root first', () => {
    expect(findWorkspaceRoots(path.join(root, 'web', 'apps'))).toEqual([path.join(root, 'web')]);
    expect(findWorkspaceRoots(monorepo)[0]).toBe(monorepo);
  });
});

describe('edge classification with workspace-package awareness', () => {
  it('labels a cross-package import as workspace, an alias as alias, and node builtin as external', () => {
    const imports = analyzeImports(webDir, path.join(webDir, 'route.ts'));
    const kindOf = (specifier: string) => imports.find((i) => i.specifier === specifier)?.edgeKind;

    expect(kindOf('@acme/db')).toBe('workspace');
    expect(kindOf('@/local')).toBe('alias');
    expect(['external', 'unresolved']).toContain(kindOf('node:fs'));
  });
});
