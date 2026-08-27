import { scanUsage, type UsageScan } from '../scanner/usage-scanner.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const CONFIG_PATH = /(^|\/)(config|env|environment)(\/|\.tsx?$)|\.config\.tsx?$/;

export interface EnvAccessViolation {
  file: string;
}

export interface EnvAccessAnalysis {
  appDir: string;
  envUserCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: EnvAccessViolation[];
}

export interface EnvAccessOptions {
  usage?: UsageScan;
}

export function detectEnvAccess(appDir: string, options: EnvAccessOptions = {}): EnvAccessAnalysis {
  const { root, files, usage } = options.usage ?? scanUsage(appDir);
  const envUsers = files.filter((file) => usage.get(file.relativePath)?.usesProcessEnv === true);
  const violations = envUsers
    .filter((file) => !CONFIG_PATH.test(file.relativePath))
    .map((file) => ({ file: file.relativePath }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    appDir: root,
    envUserCount: envUsers.length,
    offenderCount: violations.length,
    gate: evaluateGate({
      roleFileCount: envUsers.length,
      violatingFileCount: violations.length,
      roleConfidence: 1,
    }),
    violations,
  };
}
