import { scanUsage, type UsageScan } from '../scanner/usage-scanner.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const CONFIG_PATH = /(^|\/)(config|env|environment)(\/|\.tsx?$)|\.config\.tsx?$/;

export interface EnvAccessViolation {
  file: string;
}

export interface EnvAccessAnalysis {
  appDir: string;
  subjectFileCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: EnvAccessViolation[];
}

export interface EnvAccessOptions {
  usage?: UsageScan;
}

export function detectEnvAccess(appDir: string, options: EnvAccessOptions = {}): EnvAccessAnalysis {
  const { root, files, usage } = options.usage ?? scanUsage(appDir);
  const subject = files.filter((file) => !CONFIG_PATH.test(file.relativePath));
  const violations = subject
    .filter((file) => usage.get(file.relativePath)?.usesProcessEnv === true)
    .map((file) => ({ file: file.relativePath }))
    .sort((a, b) => a.file.localeCompare(b.file));

  // Vacuous guard: if nothing in the app reads process.env at all, "read env only in config" governs nothing,
  // so we have zero confidence it is a real boundary. roleConfidence 0 makes the gate REJECT, never AUTO.
  const anyEnvReader = files.some((file) => usage.get(file.relativePath)?.usesProcessEnv === true);

  return {
    appDir: root,
    subjectFileCount: subject.length,
    offenderCount: violations.length,
    gate: evaluateGate({
      roleFileCount: subject.length,
      violatingFileCount: violations.length,
      roleConfidence: anyEnvReader ? 1 : 0,
    }),
    violations,
  };
}
