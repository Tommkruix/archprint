import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImportAnalyzer } from '../../src/scanner/file-walker.js';

// The fast (non-resolving) analyzer uses the raw TypeScript parser; lock in its value-binding and
// specifier semantics so they stay equivalent to the ts-morph path.
describe('fast import analyzer', () => {
  let dir: string;
  let file: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-fast-'));
    file = path.join(dir, 'sample.ts');
    writeFileSync(
      file,
      [
        "import { a } from 'value-named';",
        "import type { T } from 'type-decl';",
        "import { type U } from 'type-only-named';",
        "import { type U2, v } from 'mixed-named';",
        "import D from 'default-imp';",
        "import * as N from 'namespace-imp';",
        "import 'side-effect';",
        "export const lazy = () => import('dynamic-imp');",
        '',
      ].join('\n'),
    );
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts specifiers (static and dynamic) and value-binding correctly', () => {
    const analyze = createImportAnalyzer(dir, { resolve: false });
    const byId = new Map(analyze(file).map((imp) => [imp.specifier, imp.hasValueBinding]));

    expect(byId.get('value-named')).toBe(true);
    expect(byId.get('type-decl')).toBe(false);
    expect(byId.get('type-only-named')).toBe(false);
    expect(byId.get('mixed-named')).toBe(true);
    expect(byId.get('default-imp')).toBe(true);
    expect(byId.get('namespace-imp')).toBe(true);
    expect(byId.get('side-effect')).toBe(true);
    expect(byId.get('dynamic-imp')).toBe(true);
  });
});
