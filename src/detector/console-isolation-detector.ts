import { scanUsage, type UsageScan } from '../scanner/usage-scanner.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const CLI_PATH = /(^|\/)(cli|scripts|bin|tools)(\/|\.tsx?$)/;

export interface ConsoleUsageViolation {
  file: string;
}

export interface ConsoleIsolationAnalysis {
  appDir: string;
  libraryFileCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: ConsoleUsageViolation[];
}

export interface ConsoleIsolationOptions {
  usage?: UsageScan;
}

export function detectConsoleIsolation(
  appDir: string,
  options: ConsoleIsolationOptions = {},
): ConsoleIsolationAnalysis {
  const { root, files, usage } = options.usage ?? scanUsage(appDir);
  const library = files.filter((file) => !CLI_PATH.test(file.relativePath));
  const violations = library
    .filter((file) => usage.get(file.relativePath)?.usesConsole === true)
    .map((file) => ({ file: file.relativePath }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    appDir: root,
    libraryFileCount: library.length,
    offenderCount: violations.length,
    gate: evaluateGate({
      roleFileCount: library.length,
      violatingFileCount: violations.length,
      roleConfidence: 1,
    }),
    violations,
  };
}
