import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export const OUTPUTS_MANIFEST_FILE = '.archprint-outputs.json';

export interface OutputsManifest {
  archprintVersion: string;
  outputs: string[];
}

function manifestPath(outDir: string): string {
  return path.join(outDir, OUTPUTS_MANIFEST_FILE);
}

export function readOutputs(outDir: string): string[] {
  const file = manifestPath(outDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<OutputsManifest>;
    return Array.isArray(parsed.outputs) ? parsed.outputs : [];
  } catch {
    return [];
  }
}

function isInside(outDir: string, relative: string): boolean {
  const resolved = path.resolve(outDir, relative);
  const base = path.resolve(outDir);
  return resolved === base ? false : resolved.startsWith(base + path.sep);
}

export function cleanPreviousOutputs(outDir: string): string[] {
  const removed: string[] = [];
  for (const relative of readOutputs(outDir)) {
    if (!isInside(outDir, relative)) continue;
    const target = path.resolve(outDir, relative);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(relative);
    }
  }
  rmSync(manifestPath(outDir), { force: true });
  return removed;
}

export function writeOutputsManifest(
  outDir: string,
  absolutePaths: readonly string[],
  version: string,
): void {
  const outputs = [...new Set(absolutePaths.map((p) => path.relative(outDir, p)))].sort();
  const manifest: OutputsManifest = { archprintVersion: version, outputs };
  writeFileSync(manifestPath(outDir), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function removeIfEmpty(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) {
    try {
      rmdirSync(dir);
    } catch {
      /* v8 ignore next -- a race or permission issue leaves the empty dir; harmless */
    }
  }
}
