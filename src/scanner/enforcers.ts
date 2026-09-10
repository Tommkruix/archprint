import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { findWorkspaceRoot } from './workspace-packages.js';

export interface InstalledEnforcers {
  eslint: boolean;
  eslintPluginImport: boolean;
  dependencyCruiser: boolean;
  biome: boolean;
}

const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];
const DEPCRUISE_CONFIGS = [
  '.dependency-cruiser.js',
  '.dependency-cruiser.cjs',
  '.dependency-cruiser.mjs',
  '.dependency-cruiser.json',
  'dependency-cruiser.config.js',
  'dependency-cruiser.config.mjs',
];
const BIOME_CONFIGS = ['biome.json', 'biome.jsonc'];
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function readDeclaredDependencies(dir: string): Set<string> {
  const names = new Set<string>();
  const packageJsonPath = path.join(dir, 'package.json');
  if (!existsSync(packageJsonPath)) return names;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) names.add(name);
    }
  } catch {
    /* a malformed package.json contributes no signal */
  }
  return names;
}

const anyExists = (dir: string, names: readonly string[]): boolean =>
  names.some((name) => existsSync(path.join(dir, name)));

export function detectEnforcers(startDir: string): InstalledEnforcers {
  const top = findWorkspaceRoot(startDir);
  const deps = new Set<string>();
  const config = { eslint: false, dependencyCruiser: false, biome: false };
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of readDeclaredDependencies(dir)) deps.add(name);
    config.eslint ||= anyExists(dir, ESLINT_CONFIGS);
    config.dependencyCruiser ||= anyExists(dir, DEPCRUISE_CONFIGS);
    config.biome ||= anyExists(dir, BIOME_CONFIGS);
    const parent = path.dirname(dir);
    if (dir === top || parent === dir) break;
    dir = parent;
  }
  return {
    eslint: deps.has('eslint') || config.eslint,
    eslintPluginImport: deps.has('eslint-plugin-import') || deps.has('eslint-plugin-import-x'),
    dependencyCruiser: deps.has('dependency-cruiser') || config.dependencyCruiser,
    biome: deps.has('@biomejs/biome') || config.biome,
  };
}
