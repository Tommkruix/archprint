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
    violations: [],
  };
}

describe('toEslintWorkspacePackageApi', () => {
  it('emits a no-restricted-imports pattern over the package names when clean (AUTO)', () => {
    const config = toEslintWorkspacePackageApi(analysis(40, 0, ['@scope/pkg-a', '@scope/pkg-b']));
    expect(config).not.toBeNull();
    expect(config!.rules['no-restricted-imports'][1].patterns[0]!.regex).toBe(
      '^(@scope/pkg-a|@scope/pkg-b)/',
    );
  });

  it('emits null with no consumers, no packages, or below AUTO', () => {
    expect(toEslintWorkspacePackageApi(analysis(0, 0, []))).toBeNull();
    expect(toEslintWorkspacePackageApi(analysis(40, 0, []))).toBeNull();
    expect(toEslintWorkspacePackageApi(analysis(5, 3, ['@scope/pkg']))).toBeNull();
  });
});
