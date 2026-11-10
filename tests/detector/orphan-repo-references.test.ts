import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referenceGraphs } from '../../src/detector/reference-graph.js';
import { detectOrphans } from '../../src/index.js';
import { writeTree } from '../integration/layer-app.js';

const SOURCE = 'export const value = 1;\n';
const json = (value: unknown): string => JSON.stringify(value);

describe('orphans: references resolved through each file’s own tsconfig', () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-orphans-nested-')));
    writeTree(repo, {
      'tsconfig.json': json({ compilerOptions: { strict: true } }),
      'landing/tsconfig.json': json({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
      'landing/app/page.tsx':
        "import { Benchmarks } from '@/components/Benchmarks';\nexport default Benchmarks;\n",
      'landing/components/Benchmarks.tsx': SOURCE,
      'landing/components/Dead.tsx': SOURCE,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('resolves a nested app’s alias when the repository root is scanned, and still lists an unused file', () => {
    expect(detectOrphans(repo).orphans).toEqual(['landing/components/Dead.tsx']);
  });

  it('gives the same answer, in app paths, when the nested app is scanned on its own', () => {
    expect(detectOrphans(path.join(repo, 'landing')).orphans).toEqual(['components/Dead.tsx']);
  });

  it('lists a file again once the import that kept it is removed', () => {
    expect(detectOrphans(repo).orphans).toEqual(['landing/components/Dead.tsx']);
    const page = path.join(repo, 'landing', 'app', 'page.tsx');
    writeFileSync(page, 'export default function Page() { return null; }\n');
    expect(detectOrphans(repo).orphans).toEqual([
      'landing/components/Benchmarks.tsx',
      'landing/components/Dead.tsx',
    ]);
  });
});

describe('orphans: references from other packages of the workspace', () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-orphans-workspace-')));
    writeTree(repo, {
      'package.json': json({ name: 'root', private: true, workspaces: ['apps/*', 'packages/*'] }),
      'apps/web/package.json': json({ name: '@acme/web' }),
      'apps/web/tsconfig.json': json({ compilerOptions: { strict: true } }),
      'apps/web/src/page.tsx':
        "import { Button } from '@acme/ui/button';\nexport default Button;\n",
      'apps/web/src/helper.test.ts':
        "import { format } from '../../../packages/ui/src/format';\nexport const t = format;\n",
      'packages/ui/package.json': json({
        name: '@acme/ui',
        private: true,
        exports: { './button': './src/button.tsx' },
      }),
      'packages/ui/tsconfig.json': json({ compilerOptions: { strict: true } }),
      'packages/ui/src/button.tsx': SOURCE,
      'packages/ui/src/format.ts': SOURCE,
      'packages/ui/src/unused.tsx': SOURCE,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('counts an import from another package, in the scanned package’s own paths', () => {
    const ui = detectOrphans(path.join(repo, 'packages', 'ui'));
    expect(ui.orphans).toEqual(['src/unused.tsx']);
  });

  it('builds one graph for the apps of a workspace when they share a factory', () => {
    const references = referenceGraphs();
    const web = references(path.join(repo, 'apps', 'web'));
    expect(references(path.join(repo, 'packages', 'ui'))).toBe(web);
    expect(referenceGraphs()(path.join(repo, 'packages', 'ui'))).not.toBe(web);
  });

  it('lists a file only another package’s tests import as test-only', () => {
    expect(detectOrphans(path.join(repo, 'packages', 'ui')).testOnly).toEqual(['src/format.ts']);
  });
});

describe('orphans: a folder a parent ignore file excludes but the app scan reads', () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-orphans-ignored-')));
    writeTree(repo, {
      '.gitignore': 'lib\n',
      'package.json': json({ name: 'root', private: true, workspaces: ['apps/*'] }),
      'apps/site/package.json': json({ name: 'site' }),
      'apps/site/tsconfig.json': json({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      'apps/site/src/lib/layout.ts':
        "import Logo from '@/components/Logo';\nexport const logo = Logo;\n",
      'apps/site/src/components/Logo.tsx': SOURCE,
    });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('still counts the references of the files the app scan reads', () => {
    expect(detectOrphans(path.join(repo, 'apps', 'site')).orphans).not.toContain(
      'src/components/Logo.tsx',
    );
  });
});
