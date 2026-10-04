import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLineLocator } from '../../src/cli/check-locate.js';
import { importLocations } from '../../src/scanner/file-walker.js';

describe('check line location', () => {
  let app: string;
  const write = (relative: string, content: string): void => {
    const file = path.join(app, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  beforeEach(() => {
    app = mkdtempSync(path.join(tmpdir(), 'archprint-locate-'));
    write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }),
    );
    write('lib/a.test.ts', 'export const a = 1;\n');
    write(
      'src/route.ts',
      [
        "// a comment that mentions '@/lib/db'",
        "import { x } from '@/lib/db';",
        "import { a } from '../lib/a.test';",
        'export const lazy = () => import("@/lib/lazy");',
        '',
      ].join('\n'),
    );
  });
  afterEach(() => rmSync(app, { recursive: true, force: true }));

  it('reads the line of each static and dynamic import from the syntax tree, not comments', () => {
    expect(importLocations(path.join(app, 'src/route.ts'))).toEqual([
      { specifier: '@/lib/db', line: 2 },
      { specifier: '../lib/a.test', line: 3 },
      { specifier: '@/lib/lazy', line: 4 },
    ]);
  });

  it('locates a specifier-based finding on its import line', () => {
    const locate = createLineLocator(app);
    expect(
      locate({ ruleId: 'AP-001', file: 'src/route.ts', subject: '@/lib/db', kind: 'specifier' }),
    ).toBe(2);
  });

  it('maps a target-based finding back to the import that resolves to that file', () => {
    const locate = createLineLocator(app);
    expect(
      locate({
        ruleId: 'test-isolation',
        file: 'src/route.ts',
        subject: 'lib/a.test.ts',
        kind: 'target',
      }),
    ).toBe(3);
  });

  it('gives no line when the import appears on more than one line, or for a file-level finding', () => {
    write(
      'src/twice.ts',
      "import { x } from '@/lib/db';\nexport const y = () => import('@/lib/db');\n",
    );
    const locate = createLineLocator(app);
    expect(
      locate({ ruleId: 'AP-001', file: 'src/twice.ts', subject: '@/lib/db', kind: 'specifier' }),
    ).toBeNull();
    expect(
      locate({ ruleId: 'console-isolation', file: 'src/route.ts', subject: '', kind: 'file' }),
    ).toBeNull();
  });

  it('gives no line for a file that no longer exists', () => {
    const locate = createLineLocator(app);
    expect(
      locate({ ruleId: 'AP-001', file: 'src/gone.ts', subject: '@/lib/db', kind: 'specifier' }),
    ).toBeNull();
  });
});
