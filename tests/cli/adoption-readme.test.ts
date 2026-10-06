import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { injectAdoptionSection, stripAdoptionSection } from '../../src/cli/adoption-readme.js';

let dir: string;
let readme: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'archprint-readme-'));
  readme = path.join(dir, 'README.md');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('injectAdoptionSection', () => {
  it('creates a README with the managed section when none exists', () => {
    expect(injectAdoptionSection(readme, 'BODY').status).toBe('created');
    const content = readFileSync(readme, 'utf8');
    expect(content).toContain('<!-- archprint:start -->');
    expect(content).toContain('<!-- archprint:end -->');
    expect(content).toContain('BODY');
  });

  it('replaces only the managed block and preserves content around it', () => {
    writeFileSync(readme, '# Title\n\nIntro.\n');
    injectAdoptionSection(readme, 'FIRST');
    injectAdoptionSection(readme, 'SECOND');
    const content = readFileSync(readme, 'utf8');
    expect(content).toContain('# Title');
    expect(content).toContain('Intro.');
    expect(content).toContain('SECOND');
    expect(content).not.toContain('FIRST');
    expect(content.match(/archprint:start/g)).toHaveLength(1);
  });

  it('skips (never mutates) when markers are unpaired', () => {
    const broken = '# Title\n\n<!-- archprint:start -->\nleftover\n';
    writeFileSync(readme, broken);
    const result = injectAdoptionSection(readme, 'BODY');
    expect(result.status).toBe('skipped');
    expect(readFileSync(readme, 'utf8')).toBe(broken);
  });

  it('preserves CRLF line endings', () => {
    writeFileSync(readme, '# Title\r\n\r\nIntro.\r\n');
    injectAdoptionSection(readme, 'BODY');
    const content = readFileSync(readme, 'utf8');
    expect(content).toContain('\r\n');
    expect(content).not.toMatch(/[^\r]\n/);
  });
});

describe('stripAdoptionSection', () => {
  it('removes the managed section and keeps the rest', () => {
    writeFileSync(readme, '# Title\n\nIntro.\n');
    injectAdoptionSection(readme, 'BODY');
    stripAdoptionSection(readme, false);
    const content = readFileSync(readme, 'utf8');
    expect(content).toContain('# Title');
    expect(content).toContain('Intro.');
    expect(content).not.toContain('archprint:start');
  });

  it('deletes a README archprint created, but only when it is now empty', () => {
    injectAdoptionSection(readme, 'BODY');
    stripAdoptionSection(readme, true);
    expect(existsSync(readme)).toBe(false);
  });

  it('keeps a pre-existing README even when told it was archprint-created', () => {
    writeFileSync(readme, '# Title\n\nIntro.\n');
    injectAdoptionSection(readme, 'BODY');
    stripAdoptionSection(readme, true);
    expect(existsSync(readme)).toBe(true);
    expect(readFileSync(readme, 'utf8')).toContain('# Title');
  });

  it.each([
    ['no newline at the end', '# Title\n\nSome text'],
    ['one newline at the end', '# Title\n\nSome text\n'],
    ['several newlines at the end', '# Title\n\nSome text\n\n\n'],
    ['Windows line endings', '# Title\r\n\r\nSome text\r\n'],
    ['mixed line endings', '# Title\r\nSome text\nMore\n'],
    ['a byte order mark', '\uFEFF# Title\n\nSome text\n'],
  ])('restores a README with %s byte for byte', (_label, original) => {
    writeFileSync(readme, original);
    injectAdoptionSection(readme, 'FIRST');
    injectAdoptionSection(readme, 'SECOND');
    stripAdoptionSection(readme, false);
    expect(readFileSync(readme, 'utf8')).toBe(original);
  });

  it('removes a section an older version appended after a blank line, keeping one final newline', () => {
    writeFileSync(
      readme,
      '# Title\n\n<!-- archprint:start -->\n## Architecture rules\n\nBODY\n<!-- archprint:end -->\n',
    );
    stripAdoptionSection(readme, false);
    expect(readFileSync(readme, 'utf8')).toBe('# Title\n');
  });

  it('is a no-op when there is no section', () => {
    writeFileSync(readme, '# Title\n');
    expect(stripAdoptionSection(readme, false).status).toBe('skipped');
    expect(stripAdoptionSection(path.join(dir, 'missing.md'), false).status).toBe('skipped');
  });
});
