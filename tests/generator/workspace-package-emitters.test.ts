import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type WorkspacePackageAnalysis,
  toEslintWorkspacePackageApi,
} from '../../src/index.js';

function analysis(
  consumerCount: number,
  offenderCount: number,
  packages: string[],
  files: string[] = [],
  subpaths: WorkspacePackageAnalysis['subpaths'] = Object.fromEntries(
    packages.map((name) => [name, []]),
  ),
): WorkspacePackageAnalysis {
  return {
    appDir: 'x',
    packages,
    subpaths,
    consumerCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: consumerCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: files.map((file) => ({
      file,
      specifier: '@scope/pkg/deep',
      package: '@scope/pkg',
    })),
  };
}

describe('toEslintWorkspacePackageApi', () => {
  it('emits the workspace-package rule over value imports of the package names when clean (AUTO)', () => {
    const config = toEslintWorkspacePackageApi(analysis(40, 0, ['@scope/pkg-a', '@scope/pkg-b']));
    expect(config?.name).toBe('workspace-package');
    expect(config?.check).toEqual({
      kind: 'import',
      regex: '^(@scope/pkg-a|@scope/pkg-b)/',
      typeImports: false,
    });
  });

  it('carries the subpath exports of the packages that define any, which the rule lets through', () => {
    const button = { key: './button', targets: ['packages/ui/src/button.tsx'] };
    const config = toEslintWorkspacePackageApi(
      analysis(40, 0, ['@scope/kit', '@scope/ui'], [], { '@scope/kit': [], '@scope/ui': [button] }),
    );
    expect(config?.check).toEqual({
      kind: 'import',
      regex: '^(@scope/kit|@scope/ui)/',
      typeImports: false,
      exports: { '@scope/ui': [button] },
    });
    expect(config?.message).toContain('or a subpath it exports');
  });

  it('emits null with no consumers, no packages, or below AUTO', () => {
    expect(toEslintWorkspacePackageApi(analysis(0, 0, []))).toBeNull();
    expect(toEslintWorkspacePackageApi(analysis(40, 0, []))).toBeNull();
    expect(toEslintWorkspacePackageApi(analysis(5, 3, ['@scope/pkg']))).toBeNull();
  });

  it('exempts the tolerated deep-into-package importers the gate accepted', () => {
    const config = toEslintWorkspacePackageApi(
      analysis(200, 1, ['@scope/pkg'], ['src/app/deep.ts']),
    );
    expect(config!.ignores).toContain('src/app/deep.ts');
    expect(config!.ignores).toContain('**/__tests__/**');
  });
});
