import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OUTPUTS_MANIFEST_FILE,
  cleanPreviousOutputs,
  readOutputs,
  removeIfEmpty,
  writeOutputsManifest,
} from '../../src/cli/outputs-manifest.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'archprint-outputs-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const touch = (relative: string): void => {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'x');
};

describe('outputs manifest', () => {
  it('readOutputs returns [] when no manifest exists', () => {
    expect(readOutputs(dir)).toEqual([]);
  });

  it('readOutputs returns [] on an invalid manifest', () => {
    writeFileSync(path.join(dir, OUTPUTS_MANIFEST_FILE), 'not json');
    expect(readOutputs(dir)).toEqual([]);
  });

  it('writeOutputsManifest records sorted, relative, de-duplicated paths', () => {
    writeOutputsManifest(
      dir,
      [path.join(dir, 'b.json'), path.join(dir, 'a.json'), path.join(dir, 'a.json')],
      '1.0.0',
    );
    expect(readOutputs(dir)).toEqual(['a.json', 'b.json']);
  });

  it('cleanPreviousOutputs removes the listed files and the manifest', () => {
    touch('one.archprint.json');
    touch('rule-dir/rule.ts');
    writeOutputsManifest(
      dir,
      [path.join(dir, 'one.archprint.json'), path.join(dir, 'rule-dir')],
      '1.0.0',
    );
    const removed = cleanPreviousOutputs(dir);
    expect(removed.sort()).toEqual(['one.archprint.json', 'rule-dir']);
    expect(existsSync(path.join(dir, 'one.archprint.json'))).toBe(false);
    expect(existsSync(path.join(dir, 'rule-dir'))).toBe(false);
    expect(existsSync(path.join(dir, OUTPUTS_MANIFEST_FILE))).toBe(false);
  });

  it('cleanPreviousOutputs refuses to delete paths outside the output directory', () => {
    const outside = path.join(dir, '..', `escape-${path.basename(dir)}.txt`);
    writeFileSync(outside, 'keep');
    writeFileSync(
      path.join(dir, OUTPUTS_MANIFEST_FILE),
      JSON.stringify({ archprintVersion: '1.0.0', outputs: [`../${path.basename(outside)}`] }),
    );
    cleanPreviousOutputs(dir);
    expect(existsSync(outside)).toBe(true);
    rmSync(outside, { force: true });
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
