import { existsSync, readFileSync, readdirSync, rmdirSync } from 'node:fs';
import * as path from 'node:path';

export const OUTPUTS_MANIFEST_FILE = '.archprint-outputs.json';

interface OutputsManifest {
  archprintVersion: string;
  outputs: string[];
}

export function readOutputs(outDir: string): string[] {
  const file = path.join(outDir, OUTPUTS_MANIFEST_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<OutputsManifest>;
    return Array.isArray(parsed.outputs) ? parsed.outputs : [];
  } catch {
    return [];
  }
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
