import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateQuote } from '../../src/cli/source-quote.js';
import { writeTree } from '../integration/layer-app.js';

describe('locateQuote', () => {
  let parent: string;
  let root: string;
  beforeEach(() => {
    parent = mkdtempSync(path.join(tmpdir(), 'archprint-quote-'));
    root = path.join(parent, 'repo');
    writeTree(root, {
      'CLAUDE.md': [
        '# Rules',
        '',
        '- Never call **`fetch`** directly',
        '  in a component.',
        '- Don’t add primitives to `src/ui`.',
      ].join('\n'),
    });
    writeFileSync(path.join(parent, 'OUTSIDE.md'), 'Never call fetch directly in a component.');
  });
  afterEach(() => rmSync(parent, { recursive: true, force: true }));

  it('finds a quote across markdown emphasis and a line break, at the line it starts', () => {
    expect(locateQuote(root, 'CLAUDE.md', 'Never call fetch directly in a component')).toEqual({
      line: 3,
    });
  });

  it('matches typographic and plain apostrophes either way', () => {
    expect(locateQuote(root, 'CLAUDE.md', "Don't add primitives to src/ui")).toEqual({ line: 5 });
  });

  it('reports a quote that is not in the file', () => {
    expect(locateQuote(root, 'CLAUDE.md', 'Never call axios directly')).toEqual({
      missing: 'the quote is not in CLAUDE.md',
    });
  });

  it('refuses a file outside the root, by path or through a link, without reading it', () => {
    expect(locateQuote(root, '../OUTSIDE.md', 'Never call fetch')).toEqual({
      missing: expect.stringContaining('../OUTSIDE.md is outside'),
    });
    symlinkSync(path.join(parent, 'OUTSIDE.md'), path.join(root, 'LINKED.md'));
    expect(locateQuote(root, 'LINKED.md', 'Never call fetch')).toEqual({
      missing: expect.stringContaining('LINKED.md links outside'),
    });
  });

  it('reports a missing file, a directory, and a file over 1 MB', () => {
    expect(locateQuote(root, 'AGENTS.md', 'anything at all')).toEqual({
      missing: 'AGENTS.md does not exist',
    });
    mkdirSync(path.join(root, 'docs'));
    expect(locateQuote(root, 'docs', 'anything at all')).toEqual({ missing: 'docs is not a file' });
    writeFileSync(path.join(root, 'BIG.md'), 'x'.repeat(1_000_001));
    expect(locateQuote(root, 'BIG.md', 'anything at all')).toEqual({
      missing: 'BIG.md is larger than 1 MB',
    });
  });
});
