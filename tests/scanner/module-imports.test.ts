import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  moduleReferences,
  valueImportBindings,
  valueModuleImports,
} from '../../src/scanner/file-walker.js';
import { globPattern, matchesGlob } from '../../src/scanner/globs.js';
import { writeTree } from '../integration/layer-app.js';

describe('valueModuleImports', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-module-imports-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const file = (source: string): string => {
    writeTree(root, { 'a.ts': source });
    return path.join(root, 'a.ts');
  };

  it('lists value imports with the exported names they take, a default as "default"', () => {
    const imports = valueModuleImports(
      file(
        [
          "import { unstable_cache as cache, revalidateTag } from 'next/cache';",
          "import React from 'react';",
          "import * as z from 'zod';",
          "import './polyfill';",
        ].join('\n'),
      ),
    );
    expect(imports).toEqual([
      { specifier: 'next/cache', line: 1, names: ['unstable_cache', 'revalidateTag'] },
      { specifier: 'react', line: 2, names: ['default'] },
      { specifier: 'zod', line: 3, names: ['*'] },
      { specifier: './polyfill', line: 4, names: [] },
    ]);
  });

  it('leaves type-only imports and type-only re-exports out, and drops type-only names', () => {
    const imports = valueModuleImports(
      file(
        [
          "import type { User } from './user';",
          "import { type Role, can } from './roles';",
          "export type { Plan } from './plan';",
          "export { type Seat } from './seat';",
        ].join('\n'),
      ),
    );
    expect(imports).toEqual([{ specifier: './roles', line: 2, names: ['can'] }]);
  });

  it('lists value re-exports with the names they take and import() calls with unknown names', () => {
    const imports = valueModuleImports(
      file(
        [
          "export { unstable_cache as cache } from 'next/cache';",
          "export * from './all';",
          "export * as ns from './ns';",
          "const lazy = () => import('./lazy');",
        ].join('\n'),
      ),
    );
    expect(imports).toEqual([
      { specifier: 'next/cache', line: 1, names: ['unstable_cache'] },
      { specifier: './all', line: 2, names: ['*'] },
      { specifier: './ns', line: 3, names: ['*'] },
      { specifier: './lazy', line: 4, names: null },
    ]);
  });

  it('counts require() as a module reference, but not as an import the rules check', () => {
    const source = file("import { a } from './a';\nconst b = require('./b');\nexport { a, b };\n");
    expect(moduleReferences(source)).toEqual(['./a', './b']);
    expect(valueModuleImports(source).map((imp) => imp.specifier)).toEqual(['./a']);
    expect(valueImportBindings(source).map((binding) => binding.specifier)).toEqual(['./a']);
  });

  it('keeps valueImportBindings to imports, without the names re-exports take', () => {
    const bindings = valueImportBindings(
      file("import { a } from './a';\nexport { b } from './b';\n"),
    );
    expect(bindings).toEqual([{ imported: 'a', local: 'a', specifier: './a' }]);
  });
});

describe('matchesGlob', () => {
  it('matches minimatch globs with dotfiles included and a leading ./ ignored, as ESLint reads them', () => {
    expect(matchesGlob('src/.storybook/main.ts', 'src/**')).toBe(true);
    expect(matchesGlob('src/a.ts', './src/*.ts')).toBe(true);
    expect(matchesGlob('src/app/[id]/page.tsx', 'src/app/**')).toBe(true);
  });

  it('anchors a pattern at the root, and lets dir/** match the directory itself', () => {
    expect(matchesGlob('src/a.ts', '*.ts')).toBe(false);
    expect(matchesGlob('packages/db', 'packages/db/**')).toBe(true);
    expect(matchesGlob('packages/db/', 'packages/db/**')).toBe(true);
    expect(matchesGlob('packages/dbx/a.ts', 'packages/db/**')).toBe(false);
  });
});

describe('globPattern', () => {
  it('compiles a glob to a source and flags that rebuild the same matcher', () => {
    const { source, flags } = globPattern('src/components/**');
    const rebuilt = new RegExp(source, flags);
    expect(rebuilt.test('src/components/card.tsx')).toBe(true);
    expect(rebuilt.test('src/lib/db.ts')).toBe(false);
  });

  it('turns a glob minimatch reads as a comment into one that matches nothing', () => {
    const { source, flags } = globPattern('#not a glob');
    expect(new RegExp(source, flags).test('#not a glob')).toBe(false);
    expect(matchesGlob('', '#')).toBe(false);
  });
});
