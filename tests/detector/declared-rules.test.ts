import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DeclaredDefinition,
  type DeclaredMeasure,
  loadCodebase,
  measureDeclared,
} from '../../src/detector/declared-rules.js';
import { writeTree } from '../integration/layer-app.js';

/** A monorepo whose app is reached by a relative path, a tsconfig alias and a workspace package name. */
const MONOREPO: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'root',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
  }),
  'apps/web/package.json': JSON.stringify({ name: '@acme/web' }),
  'apps/web/tsconfig.json': JSON.stringify({
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
  }),
  'apps/web/src/app.ts': 'export const app = 1;\n',
  'apps/web/src/lib/db.ts': 'export const db = 1;\n',
  'apps/web/src/components/list.tsx': "import { db } from '@/lib/db';\nexport const List = db;\n",
  'apps/web/src/components/card.tsx': "export const Card = fetch('/x');\n",
  'apps/web/src/components/types.ts':
    "import type { db } from '@/lib/db';\nexport type Db = typeof db;\n",
  'apps/web/src/components/card.test.tsx':
    "import { db } from '@/lib/db';\nexport const t = [db, fetch('/t')];\n",
  'apps/web/src/server/route.ts':
    "import { db } from '../lib/db';\nexport const r = [db, fetch('/y')];\n",
  'packages/db/package.json': JSON.stringify({ name: '@acme/db', main: './src/index.js' }),
  'packages/db/src/index.ts': 'export const prisma = 1;\n',
  'packages/mcds/package.json': JSON.stringify({ name: '@acme/mcds' }),
  'packages/mcds/index.ts': "export * from './button';\n",
  'packages/mcds/button.tsx':
    "import { app } from '../../apps/web/src/app';\nexport const B = app;\n",
  'packages/mcds/button.test.tsx': "import { B } from './button';\nexport const t = B;\n",
  'packages/mcds/input.tsx': "import { app } from '@acme/web/src/app';\nexport const I = app;\n",
  'packages/mcds/data.ts': "import { prisma } from '@acme/db';\nexport const d = prisma;\n",
};

describe('measureDeclared', () => {
  let root: string;
  let measure: (rule: DeclaredDefinition) => DeclaredMeasure;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-declared-'));
    writeTree(root, MONOREPO);
    const codebase = loadCodebase(root);
    measure = (rule) => measureDeclared(codebase, [rule])[0]!;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const violations = (result: DeclaredMeasure): string[] =>
    result.violations.map(
      (violation) => `${violation.file}:${violation.line} ${violation.subject}`,
    );

  it('forbids imports of a path by relative path and by workspace package name, across apps', () => {
    const result = measure({
      template: 'forbid-import',
      files: ['packages/mcds/**'],
      except: [],
      targets: ['apps/web/**'],
      packages: [],
    });
    expect(result.scope).toEqual([
      'packages/mcds/button.tsx',
      'packages/mcds/data.ts',
      'packages/mcds/index.ts',
      'packages/mcds/input.tsx',
    ]);
    expect(violations(result)).toEqual([
      'packages/mcds/button.tsx:1 ../../apps/web/src/app',
      'packages/mcds/input.tsx:1 @acme/web/src/app',
    ]);
    expect(result.unmatchedTargets).toEqual([]);
  });

  it('resolves aliases, leaves tests and type-only imports out, and counts other files as elsewhere', () => {
    const result = measure({
      template: 'forbid-import',
      files: ['apps/web/src/components/**'],
      except: [],
      targets: ['apps/web/src/lib/**'],
      packages: [],
    });
    expect(result.scope).toEqual([
      'apps/web/src/components/card.tsx',
      'apps/web/src/components/list.tsx',
      'apps/web/src/components/types.ts',
    ]);
    expect(violations(result)).toEqual(['apps/web/src/components/list.tsx:1 @/lib/db']);
    expect(result.elsewhere).toEqual(['apps/web/src/server/route.ts']);
  });

  it('matches a workspace package root through its entry, as a target and as a package', () => {
    const asTarget = measure({
      template: 'forbid-import',
      files: ['packages/mcds/**'],
      except: [],
      targets: ['packages/db/**'],
      packages: [],
    });
    const asPackage = measure({
      template: 'forbid-import',
      files: ['packages/mcds/**'],
      except: [],
      targets: [],
      packages: [{ name: '@acme/db' }],
    });
    expect(violations(asTarget)).toEqual(['packages/mcds/data.ts:1 @acme/db']);
    expect(violations(asPackage)).toEqual(violations(asTarget));
  });

  it('limits a package rule to the named exports it lists', () => {
    const rule = (imports: string[]): DeclaredDefinition => ({
      template: 'forbid-import',
      files: ['packages/mcds/**'],
      except: [],
      targets: [],
      packages: [{ name: '@acme/db', imports }],
    });
    expect(violations(measure(rule(['prisma'])))).toEqual(['packages/mcds/data.ts:1 @acme/db']);
    expect(measure(rule(['client'])).violations).toEqual([]);
  });

  it('reports a target glob that no source file matches', () => {
    const result = measure({
      template: 'forbid-import',
      files: ['packages/mcds/**'],
      except: [],
      targets: ['apps/web/**', 'apps/admin/**'],
      packages: [],
    });
    expect(result.unmatchedTargets).toEqual(['apps/admin/**']);
  });

  it('forbids a global in scope, leaves tests out and excepted files out of the scope', () => {
    const result = measure({
      template: 'forbid-usage',
      files: ['apps/web/src/**'],
      except: ['apps/web/src/server/**'],
      usage: ['fetch'],
    });
    expect(violations(result)).toEqual(['apps/web/src/components/card.tsx:1 fetch']);
    expect(result.scope).not.toContain('apps/web/src/server/route.ts');
    expect(result.scope).not.toContain('apps/web/src/components/card.test.tsx');
    expect(result.elsewhere).toEqual(['apps/web/src/server/route.ts']);
  });

  it('resolves an alias through the deepest tsconfig above the file, not an outer one', () => {
    writeTree(root, {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./packages/mcds/*'] } },
      }),
    });
    try {
      const result = measureDeclared(loadCodebase(root), [
        {
          template: 'forbid-import',
          files: ['apps/web/src/components/**'],
          except: [],
          targets: ['apps/web/src/lib/**'],
          packages: [],
        },
      ])[0]!;
      expect(violations(result)).toEqual(['apps/web/src/components/list.tsx:1 @/lib/db']);
    } finally {
      rmSync(path.join(root, 'tsconfig.json'));
    }
  });

  it('leaves out workspace packages outside the directory passed, which no glob can name', () => {
    const fromPackages = loadCodebase(path.join(root, 'packages'));
    const input = fromPackages.files.find((file) => file.path === 'mcds/input.tsx')!;
    expect(fromPackages.targetOf(input, '@acme/web/src/app')).toBeNull();
    expect(fromPackages.targetOf(input, '@acme/db')).toBe('db/src/index.ts');
  });

  it('freezes every file a forbid-file glob matches today, tests included', () => {
    const result = measure({
      template: 'forbid-file',
      files: ['packages/mcds/**'],
      except: ['packages/mcds/index.ts'],
    });
    expect(result.scope).toEqual([
      'packages/mcds/button.test.tsx',
      'packages/mcds/button.tsx',
      'packages/mcds/data.ts',
      'packages/mcds/input.tsx',
    ]);
    expect(result.violations.map((violation) => violation.file)).toEqual(result.scope);
  });
});

describe('loadCodebase: workspace packages', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-declared-ws-'));
    writeTree(root, {
      'go.mod': 'module example.com/svc\n',
      'web/pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "internal/*"\n',
      'web/apps/portal/package.json': JSON.stringify({ name: '@acme/portal' }),
      'web/apps/portal/src/page.tsx': "import { brand } from '@acme/brand/src/lib/brand';\n",
      'web/internal/brand/package.json': JSON.stringify({ name: '@acme/brand' }),
      'web/internal/brand/src/lib/brand.ts': 'export const brand = 1;\n',
      'web/internal/ui/package.json': JSON.stringify({ name: '@acme/ui' }),
      'web/internal/ui/src/lib/button.ts': 'export const button = 1;\n',
      'web/internal/core/package.json': JSON.stringify({
        name: '@acme/core',
        exports: {
          '.': './src/index.ts',
          './v3/*': { types: './dist/v3/*.d.ts', source: './src/v3/*.ts' },
        },
      }),
      'web/internal/core/src/index.ts': 'export const core = 1;\n',
      'web/internal/core/src/v3/zod.ts': 'export const zod = 1;\n',
      'web/examples/demo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'web/examples/demo/packages/ui/package.json': JSON.stringify({ name: '@acme/ui' }),
      'web/examples/demo/packages/ui/src/lib/button.ts': 'export const button = 2;\n',
      'web/examples/demo/app.ts': "import { button } from '@acme/ui/src/lib/button';\n",
    });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const targetFrom = (file: string, specifier: string): string | null => {
    const codebase = loadCodebase(root);
    return codebase.targetOf(
      codebase.files.find((candidate) => candidate.path === file)!,
      specifier,
    );
  };

  it('reads the packages of a workspace nested below the root, as in a repository whose JavaScript lives in a subfolder', () => {
    expect(targetFrom('web/apps/portal/src/page.tsx', '@acme/brand/src/lib/brand')).toBe(
      'web/internal/brand/src/lib/brand.ts',
    );
  });

  it('resolves a subpath through the package exports, not its directory', () => {
    expect(targetFrom('web/apps/portal/src/page.tsx', '@acme/core/v3/zod')).toBe(
      'web/internal/core/src/v3/zod.ts',
    );
  });

  it('takes the shallowest workspace on a name clash, so a nested example does not shadow the real package', () => {
    expect(targetFrom('web/examples/demo/app.ts', '@acme/ui/src/lib/button')).toBe(
      'web/internal/ui/src/lib/button.ts',
    );
  });
});
