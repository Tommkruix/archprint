import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const BUILTINS = new Set(builtinModules);
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function packageName(specifier: string, aliasPrefixes: readonly string[]): string | null {
  if (specifier.startsWith('.')) return null;
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (specifier.startsWith('node:') || BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0]!)) {
    return null;
  }
  for (const prefix of aliasPrefixes) {
    if (specifier === prefix || specifier.startsWith(`${prefix}/`)) return null;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function declaredIn(packageJsonPath: string, into: Set<string>): void {
  if (!existsSync(packageJsonPath)) return;
  try {
    const json = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
    for (const field of DEP_FIELDS) {
      const deps = json[field];
      if (deps && typeof deps === 'object') {
        for (const name of Object.keys(deps as Record<string, unknown>)) into.add(name);
      }
    }
  } catch {
    /* v8 ignore next -- unreadable/invalid package.json is treated as declaring nothing */
  }
}

export interface PhantomDependencyViolation {
  file: string;
  specifier: string;
  package: string;
}

export interface PhantomDependencyAnalysis {
  appDir: string;
  externalImporterCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: PhantomDependencyViolation[];
}

export interface PhantomDependencyOptions {
  resolve?: boolean;
}

export function detectPhantomDependencies(
  appDir: string,
  options: PhantomDependencyOptions = {},
): PhantomDependencyAnalysis {
  const root = path.resolve(appDir);
  const resolve = options.resolve ?? false;
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const aliasPrefixes = Object.keys(buildWorkspaceMap(root)).map((key) =>
    key.replace(/\/?\*$/, ''),
  );

  const declared = new Set<string>();
  declaredIn(path.join(root, 'package.json'), declared);
  const workspaceRoot = findWorkspaceRoot(root);
  if (workspaceRoot !== root) declaredIn(path.join(workspaceRoot, 'package.json'), declared);
  for (const name of Object.keys(buildWorkspacePackageMap(workspaceRoot))) declared.add(name);

  const analyze = createImportAnalyzer(root, { resolve });
  const externalImporters = new Set<string>();
  const offenders = new Set<string>();
  const violations: PhantomDependencyViolation[] = [];
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
      const name = packageName(imp.specifier, aliasPrefixes);
      if (name === null) continue;
      externalImporters.add(file.relativePath);
      if (!declared.has(name)) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier, package: name });
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
