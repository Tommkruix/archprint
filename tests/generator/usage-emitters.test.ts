import { describe, expect, it } from 'vitest';
import {
  type ConsoleIsolationAnalysis,
  type EnvAccessAnalysis,
  evaluateGate,
  toEslintConsoleIsolation,
  toEslintEnvAccess,
} from '../../src/index.js';

const consoleAnalysis = (n: number, v: number): ConsoleIsolationAnalysis => ({
  appDir: 'x',
  libraryFileCount: n,
  offenderCount: v,
  gate: evaluateGate({ roleFileCount: n, violatingFileCount: v, roleConfidence: 1 }),
  violations: [],
});

const envAnalysis = (n: number, v: number): EnvAccessAnalysis => ({
  appDir: 'x',
  subjectFileCount: n,
  offenderCount: v,
  gate: evaluateGate({ roleFileCount: n, violatingFileCount: v, roleConfidence: 1 }),
  violations: [],
});

describe('toEslintConsoleIsolation', () => {
  it('emits a scoped no-console rule when clean (AUTO)', () => {
    const config = toEslintConsoleIsolation(consoleAnalysis(40, 0));
    expect(config?.rules['no-console']).toBe('error');
    expect(config?.ignores).toContain('**/cli/**');
  });

  it('emits null with no library files or below AUTO', () => {
    expect(toEslintConsoleIsolation(consoleAnalysis(0, 0))).toBeNull();
    expect(toEslintConsoleIsolation(consoleAnalysis(5, 3))).toBeNull();
  });
});

describe('toEslintEnvAccess', () => {
  it('emits a scoped no-restricted-properties rule for process.env when clean (AUTO)', () => {
    const config = toEslintEnvAccess(envAnalysis(40, 0));
    expect(config?.rules['no-restricted-properties']).toBeDefined();
    expect(config?.ignores).toContain('**/config/**');
  });

  it('emits null with no env users or below AUTO', () => {
    expect(toEslintEnvAccess(envAnalysis(0, 0))).toBeNull();
    expect(toEslintEnvAccess(envAnalysis(5, 3))).toBeNull();
  });
});
