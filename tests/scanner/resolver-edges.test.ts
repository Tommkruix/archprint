import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceMap } from '../../src/scanner/workspace-resolver.js';
import {
  buildWorkspacePackageMap,
  findWorkspaceRoot,
} from '../../src/scanner/workspace-packages.js';
import { resolveToLeafFiles } from '../../src/scanner/barrel-resolver.js';
import { analyzeImports, walkRepo } from '../../src/scanner/file-walker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);

describe('workspace resolver edges', () => {
  it('returns an empty map for a malformed tsconfig', () => {
    expect(buildWorkspaceMap(fixture('bad-tsconfig'))).toEqual({});
  });

  it('skips a paths alias whose target list is empty', () => {
    expect(buildWorkspaceMap(fixture('empty-paths'))).toEqual({});
  });

  it('returns an empty map when there is no tsconfig', () => {
    expect(buildWorkspaceMap(fixture('barrel-unresolved/does-not-exist'))).toEqual({});
  });
});

describe('workspace package map', () => {
  it('reads a pnpm-workspace.yaml packages list', () => {
    const map = buildWorkspacePackageMap(fixture('pnpm-ws'));
    expect(Object.keys(map)).toContain('@ws/a');
  });

  it('reads a package.json workspaces object form', () => {
    const map = buildWorkspacePackageMap(fixture('ws-json-object'));
    expect(Object.keys(map)).toContain('@ws/b');
  });

  it('finds the workspace root via pnpm-workspace.yaml', () => {
    const root = fixture('pnpm-ws');
    expect(findWorkspaceRoot(path.join(root, 'packages', 'pkg-a'))).toBe(root);
  });

  it('finds the workspace root via package.json workspaces', () => {
    const root = fixture('ws-json-object');
    expect(findWorkspaceRoot(path.join(root, 'packages', 'pkg-b'))).toBe(root);
  });

  it('skips a workspace glob dir that has no package.json', () => {
    const map = buildWorkspacePackageMap(fixture('ws-empty-member'));
    expect(map).toEqual({});
  });
});

describe('barrel resolver edges', () => {
  it('skips a re-export that does not resolve', () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const barrel = project.addSourceFileAtPath(fixture('barrel-unresolved/index.ts'));
    expect(resolveToLeafFiles(barrel)).toEqual([]);
  });
});

describe('analyzeImports (deep) through a barrel', () => {
  it('resolves a namespace import through a barrel to its leaf', () => {
    const app = fixture('barrel-ns');
    const imports = analyzeImports(app, path.join(app, 'consumer.ts'));
    const barrelImport = imports.find((entry) => entry.specifier === '@/lib');
    expect(barrelImport?.throughBarrel).toBe(true);
    expect(barrelImport?.valueLeafPaths.some((leaf) => leaf.endsWith('impl.ts'))).toBe(true);
  });

  it('upgrades a "use server" module and resolves a bare non-barrel import', () => {
    const app = fixture('use-server-fx');
    const action = walkRepo(app).find((f) => f.relativePath === 'action.ts');
    expect(action?.role).toBe('SERVER_ACTION');
    const imports = analyzeImports(app, path.join(app, 'action.ts'));
    const bare = imports.find((entry) => entry.specifier === '@/side-effect');
    expect(bare?.valueLeafPaths.some((leaf) => leaf.endsWith('side-effect.ts'))).toBe(true);
  });
});
