import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureIgnoreEntry, removeIgnoreEntry } from '../../src/cli/ignore-file.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'archprint-ignore-'));
  file = path.join(dir, '.prettierignore');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ensureIgnoreEntry', () => {
  it('creates the file with a managed block when absent', () => {
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('created');
    expect(readFileSync(file, 'utf8')).toContain('.archprint/');
  });

  it('appends the managed block to an existing file, preserving its content', () => {
    writeFileSync(file, 'dist\n');
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('appended');
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('dist');
    expect(content).toContain('# archprint:start');
  });

  it('is idempotent and does not duplicate the block', () => {
    ensureIgnoreEntry(file, '.archprint/');
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('present');
    expect(readFileSync(file, 'utf8').match(/# archprint:start/g)).toHaveLength(1);
  });

  it('skips instead of duplicating when a marker is unpaired', () => {
    writeFileSync(file, 'dist\n\n# archprint:start\n.archprint/\n');
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('present');
  });

  it('does not create the file when create is false (never clobbers npm pack behavior)', () => {
    expect(ensureIgnoreEntry(file, '.archprint/', { create: false })).toBe('skipped');
    expect(existsSync(file)).toBe(false);
  });

  it('reports created vs appended vs present', () => {
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('created');
    rmSync(file, { force: true });
    writeFileSync(file, 'dist\n');
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('appended');
    expect(ensureIgnoreEntry(file, '.archprint/')).toBe('present');
  });
});

describe('removeIgnoreEntry', () => {
  it('removes the managed block and keeps user content', () => {
    writeFileSync(file, 'dist\n');
    ensureIgnoreEntry(file, '.archprint/');
    expect(removeIgnoreEntry(file)).toBe(true);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('dist');
    expect(content).not.toContain('# archprint:start');
  });

  it('empties a file that held only the managed block', () => {
    ensureIgnoreEntry(file, '.archprint/');
    removeIgnoreEntry(file);
    expect(readFileSync(file, 'utf8')).toBe('');
  });

  it('deletes an archprint-created file left empty when deleteIfEmpty is set', () => {
    ensureIgnoreEntry(file, '.archprint/');
    removeIgnoreEntry(file, { deleteIfEmpty: true });
    expect(existsSync(file)).toBe(false);
  });

  it.each([
    ['no newline at the end', 'node_modules\ndist'],
    ['one newline at the end', 'node_modules\ndist\n'],
    ['several newlines at the end', 'dist\n\n\n'],
    ['leading blank lines', '\n\ndist\n'],
    ['Windows line endings', 'node_modules\r\ndist\r\n'],
    ['nothing at all', ''],
  ])('restores a file with %s byte for byte', (_label, original) => {
    writeFileSync(file, original);
    ensureIgnoreEntry(file, '.archprint/');
    removeIgnoreEntry(file);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('removes a block an older version appended after a blank line, keeping one final newline', () => {
    writeFileSync(file, 'dist\n\n# archprint:start\n.archprint/\n# archprint:end\n');
    removeIgnoreEntry(file);
    expect(readFileSync(file, 'utf8')).toBe('dist\n');
  });

  it("writes the block in a Windows file's own line endings", () => {
    writeFileSync(file, 'dist\r\n');
    ensureIgnoreEntry(file, '.archprint/');
    expect(readFileSync(file, 'utf8')).not.toMatch(/[^\r]\n/);
  });

  it('removes a block whose line breaks were converted to Windows endings, leaving no stray carriage return', () => {
    writeFileSync(
      file,
      'dist\r\n\r\n# archprint:start\r\n.archprint/\r\n# archprint:end\r\nbuild\r\n',
    );
    removeIgnoreEntry(file);
    expect(readFileSync(file, 'utf8')).toBe('dist\r\nbuild\r\n');
  });

  it('no-ops when the file is missing or has no block', () => {
    expect(removeIgnoreEntry(path.join(dir, 'missing'))).toBe(false);
    writeFileSync(file, 'dist\n');
    expect(removeIgnoreEntry(file)).toBe(false);
  });
});
