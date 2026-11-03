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
): WorkspacePackageAnalysis {
  return {
    appDir: 'x',
    packages,
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
