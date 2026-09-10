import { describe, expect, it } from 'vitest';
import {
  type ConsoleIsolationAnalysis,
  type EnvAccessAnalysis,
  evaluateGate,
  toEslintConsoleIsolation,
  toEslintEnvAccess,
} from '../../src/index.js';

const consoleAnalysis = (n: number, v: number, files: string[] = []): ConsoleIsolationAnalysis => ({
  appDir: 'x',
  libraryFileCount: n,
  offenderCount: v,
  gate: evaluateGate({ roleFileCount: n, violatingFileCount: v, roleConfidence: 1 }),
  violations: files.map((file) => ({ file })),
});

const envAnalysis = (n: number, v: number, files: string[] = []): EnvAccessAnalysis => ({
  appDir: 'x',
  subjectFileCount: n,
  offenderCount: v,
  gate: evaluateGate({ roleFileCount: n, violatingFileCount: v, roleConfidence: 1 }),
  violations: files.map((file) => ({ file })),
});

describe('toEslintConsoleIsolation', () => {
  it('emits a no-console rule scoped to the population the detector scored (excludes tests + cli files)', () => {
    const config = toEslintConsoleIsolation(consoleAnalysis(40, 0));
    expect(config?.rules['no-console']).toBe('error');
    expect(config?.ignores).toContain('**/cli/**');
    expect(config?.ignores).toContain('**/cli.{ts,tsx}');
    expect(config?.ignores).toContain('**/__tests__/**');
    expect(config?.ignores).toContain('**/*.{test,spec,e2e-spec,e2e}.{ts,tsx}');
  });

  it('emits null with no library files or below AUTO', () => {
    expect(toEslintConsoleIsolation(consoleAnalysis(0, 0))).toBeNull();
    expect(toEslintConsoleIsolation(consoleAnalysis(5, 3))).toBeNull();
  });

  it('exempts the tolerated files the gate accepted, so the rule is green by construction', () => {
    const analysis = consoleAnalysis(200, 1, ['src/lib/storage.ts']);
    expect(analysis.gate.status).toBe('AUTO');
    const config = toEslintConsoleIsolation(analysis);
    expect(config?.ignores).toContain('src/lib/storage.ts');
    expect(config?.ignores).toContain('**/cli/**');
  });
});

describe('toEslintEnvAccess', () => {
  it('emits a no-restricted-properties rule scoped to the scored population (excludes tests + config files)', () => {
    const config = toEslintEnvAccess(envAnalysis(40, 0));
    expect(config?.ignores).toContain('**/*.config.{ts,tsx}');
    expect(config?.ignores).toContain('**/__tests__/**');
    expect(config?.rules['no-restricted-properties']).toBeDefined();
    expect(config?.ignores).toContain('**/config/**');
  });

  it('emits null with no env users or below AUTO', () => {
    expect(toEslintEnvAccess(envAnalysis(0, 0))).toBeNull();
    expect(toEslintEnvAccess(envAnalysis(5, 3))).toBeNull();
  });

  it('exempts the tolerated process.env readers the gate accepted', () => {
    const analysis = envAnalysis(200, 1, ['src/lib/runtime.ts']);
    expect(analysis.gate.status).toBe('AUTO');
    const config = toEslintEnvAccess(analysis);
    expect(config?.ignores).toContain('src/lib/runtime.ts');
    expect(config?.ignores).toContain('**/config/**');
  });
});
