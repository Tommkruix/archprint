import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OUTPUTS_MANIFEST_FILE,
  readOutputs,
  removeIfEmpty,
} from '../../src/cli/outputs-manifest.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'archprint-outputs-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('outputs manifest (legacy read for back-compat)', () => {
  it('readOutputs returns [] when no manifest exists', () => {
    expect(readOutputs(dir)).toEqual([]);
  });

  it('readOutputs returns [] on an invalid manifest', () => {
    writeFileSync(path.join(dir, OUTPUTS_MANIFEST_FILE), 'not json');
    expect(readOutputs(dir)).toEqual([]);
  });

  it('readOutputs returns the listed outputs from a legacy manifest', () => {
    writeFileSync(
      path.join(dir, OUTPUTS_MANIFEST_FILE),
      JSON.stringify({ archprintVersion: '0.5.0', outputs: ['a.json', 'b.json'] }),
    );
    expect(readOutputs(dir)).toEqual(['a.json', 'b.json']);
  });

  it('removeIfEmpty removes an empty directory but keeps a non-empty one', () => {
    const empty = path.join(dir, 'empty');
    mkdirSync(empty);
    removeIfEmpty(empty);
    expect(existsSync(empty)).toBe(false);

    const full = path.join(dir, 'full');
    mkdirSync(full);
    writeFileSync(path.join(full, 'f'), 'x');
    removeIfEmpty(full);
    expect(existsSync(full)).toBe(true);
  });
});
