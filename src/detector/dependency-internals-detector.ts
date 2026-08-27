import { builtinModules } from 'node:module';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import * as path from 'node:path';
import { evaluateGate, type GateResult } from './confidence-gate.js';

/** Directory names inside a published package that hold build output / implementation, never a public API. */
const INTERNAL_DIRS = new Set([
  'dist',
  'src',
  'lib',
  'esm',
  'cjs',
  'build',
  'out',
  'internal',
  'internals',
]);
const BUILTINS = new Set(builtinModules);

type SpecifierKind = 'first-party' | 'builtin' | 'external' | 'internal';

/** Classify an import specifier. `internal` means it reaches into a third-party package's build/impl directory
 *  (e.g. `lodash/dist/...`, `@scope/pkg/src/...`) rather than its public entry or a documented subpath. */
function classifySpecifier(specifier: string, aliasPrefixes: readonly string[]): SpecifierKind {
  if (specifier.startsWith('.')) return 'first-party';
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (specifier.startsWith('node:') || BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0]!)) {
    return 'builtin';
  }
  for (const prefix of aliasPrefixes) {
    if (specifier === prefix || specifier.startsWith(`${prefix}/`)) return 'first-party';
  }
  const parts = specifier.split('/');
  const rest = specifier.startsWith('@') ? parts.slice(2) : parts.slice(1);
  return rest.length > 0 && INTERNAL_DIRS.has(rest[0]!) ? 'internal' : 'external';
}

export interface DependencyInternalViolation {
  /** The file that deep-imports a dependency's internals. */
  file: string;
  /** The offending specifier, e.g. `lodash/dist/chunk`. */
  specifier: string;
}

export interface DependencyInternalsAnalysis {
  appDir: string;
  /** Files that import at least one third-party package (the role sample). */
  externalImporterCount: number;
  /** Files that import a dependency's internal build/impl path. */
  offenderCount: number;
  gate: GateResult;
  violations: DependencyInternalViolation[];
}

export interface DependencyInternalsOptions {
  resolve?: boolean;
}

/**
 * Infer the "import dependencies by their public entry" rule: a file should import a third-party package by
 * its name or a documented subpath, not by reaching into its build/impl directories (`dist`, `src`, `lib`,
 * ...). Counts files that import any external package (role sample) and those that deep-import an internal
 * path, then gates with the Wilson floor. Only meaningful when `externalImporterCount > 0`.
 */
export function detectDependencyInternals(
  appDir: string,
  options: DependencyInternalsOptions = {},
): DependencyInternalsAnalysis {
  const root = path.resolve(appDir);
  const resolve = options.resolve ?? false;
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const aliasPrefixes = Object.keys(buildWorkspaceMap(root)).map((key) =>
    key.replace(/\/?\*$/, ''),
  );
  const analyze = createImportAnalyzer(root, { resolve });

  const externalImporters = new Set<string>();
  const offenders = new Set<string>();
  const violations: DependencyInternalViolation[] = [];
  for (const file of files) {
    let imports: ResolvedImport[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: analyze throws only on an unreadable/malformed source file */
      imports = [];
    }
    for (const imp of imports) {
      if (!imp.hasValueBinding) continue;
      const kind = classifySpecifier(imp.specifier, aliasPrefixes);
      if (kind === 'external' || kind === 'internal') externalImporters.add(file.relativePath);
      if (kind === 'internal') {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier });
      }
    }
  }

  return {
    appDir: root,
    externalImporterCount: externalImporters.size,
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: externalImporters.size,
      violatingFileCount: offenders.size,
      roleConfidence: 1,
    }),
    violations: violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier),
    ),
  };
}
