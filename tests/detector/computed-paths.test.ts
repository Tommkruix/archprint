import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { writeTree } from '../integration/layer-app.js';

const MODULE = 'export const value = 1;\n';

describe('files a module loads by a path it computes', () => {
  const temps: string[] = [];
  const orphansOf = (files: Record<string, string>): string[] => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-computed-')));
    temps.push(dir);
    writeTree(dir, { 'tsconfig.json': '{}', 'package.json': '{"name":"app"}', ...files });
    return detectOrphans(dir).orphans;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('follows a path.join from __dirname through a const into import(), holes spanning folders outside Vite', () => {
    const orphans = orphansOf({
      'evals/run.ts': [
        "import path from 'node:path';",
        'export async function run(input: { name: string }) {',
        '  const taskModulePath = path.join(__dirname, "tasks", `${input.name}.ts`);',
        '  return import(taskModulePath);',
        '}',
      ].join('\n'),
      'evals/tasks/costar.ts': MODULE,
      'evals/tasks/experimental/apple.ts': MODULE,
      'evals/tasks/notes.tsx': MODULE,
      'evals/other.ts': MODULE,
    });
    expect(orphans).not.toContain('evals/tasks/costar.ts');
    expect(orphans).not.toContain('evals/tasks/experimental/apple.ts');
    expect(orphans).toContain('evals/tasks/notes.tsx');
    expect(orphans).toContain('evals/other.ts');
  });

  it('follows join imported by name from node:path, not a join of its own', () => {
    const orphans = orphansOf({
      'cli/load.ts': [
        "import { join } from 'node:path';",
        "import { join as glue } from './glue';",
        'export const load = (name: string) => import(join(__dirname, "commands", `${name}.ts`));',
        'export const other = (name: string) => import(glue(__dirname, "steps", `${name}.ts`));',
      ].join('\n'),
      'cli/glue.ts': 'export const join = (...parts: string[]) => parts.join("/");\n',
      'cli/commands/deploy.ts': MODULE,
      'cli/steps/build.ts': MODULE,
    });
    expect(orphans).not.toContain('cli/commands/deploy.ts');
    expect(orphans).toContain('cli/steps/build.ts');
  });

  it("follows join destructured from require('path') in a CommonJS file", () => {
    const orphans = orphansOf({
      'scripts/load.cjs': [
        "const { join: glue } = require('path');",
        'module.exports = (name) => require(glue(__dirname, "steps", `${name}.ts`));',
      ].join('\n'),
      'scripts/steps/build.ts': MODULE,
      'scripts/other.ts': MODULE,
    });
    expect(orphans).not.toContain('scripts/steps/build.ts');
    expect(orphans).toContain('scripts/other.ts');
  });

  it('reads path.resolve with import.meta.dirname and pathToFileURL(...).href', () => {
    const orphans = orphansOf({
      'cli/load.ts': [
        "import path from 'node:path';",
        "import { pathToFileURL } from 'node:url';",
        'export const load = (name: string) =>',
        "  import(pathToFileURL(path.resolve(import.meta.dirname, '..', 'commands', `${name}.js`)).href);",
      ].join('\n'),
      'commands/deploy.ts': MODULE,
      'cli/commands/deploy.ts': MODULE,
    });
    expect(orphans).not.toContain('commands/deploy.ts');
    expect(orphans).toContain('cli/commands/deploy.ts');
  });

  it('expands a template import() one folder deep in a Vite project, through an alias, only with an extension', () => {
    const orphans = orphansOf({
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      'vite.config.ts': 'export default {};\n',
      'src/main.ts': [
        'export const page = (name: string) => import(`./pages/${name}.tsx`);',
        'export const icon = (name: string) => import(`@/icons/${name}.tsx`);',
        'export const widget = (name: string) => import(`./widgets/${name}`);',
        'export const own = (name: string) => import(`./${name}.tsx`);',
        'export const named = (name: string) => import(`./module-${name}.tsx`);',
      ].join('\n'),
      'src/pages/home.tsx': MODULE,
      'src/pages/admin/users.tsx': MODULE,
      'src/icons/star.tsx': MODULE,
      'src/icons/brand/logo.tsx': MODULE,
      'src/widgets/chart.tsx': MODULE,
      'src/sibling.tsx': MODULE,
      'src/module-auth.tsx': MODULE,
    });
    expect(orphans).not.toContain('src/pages/home.tsx');
    expect(orphans).toContain('src/pages/admin/users.tsx');
    expect(orphans).not.toContain('src/icons/star.tsx');
    expect(orphans).toContain('src/icons/brand/logo.tsx');
    expect(orphans).toContain('src/widgets/chart.tsx');
    expect(orphans).toContain('src/sibling.tsx');
    expect(orphans).not.toContain('src/module-auth.tsx');
  });

  it('counts the file new URL(path, import.meta.url) names, a .js name standing for its .ts source', () => {
    const orphans = orphansOf({
      'src/extract.ts': [
        "export const one = new Worker(new URL('./worker.ts', import.meta.url));",
        'export const pool = (n: string) => new Worker(new URL(`./workers/${n}.js`, import.meta.url));',
        "export const remote = new URL('https://example.com/x.ts', import.meta.url);",
        "export const elsewhere = new URL('./served.ts', 'https://example.com/');",
        "export const notAlias = new URL('@/aliased.ts', import.meta.url);",
      ].join('\n'),
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      'src/worker.ts': MODULE,
      'src/workers/resize.ts': MODULE,
      'src/x.ts': MODULE,
      'src/served.ts': MODULE,
      'src/aliased.ts': MODULE,
    });
    expect(orphans).not.toContain('src/worker.ts');
    expect(orphans).not.toContain('src/workers/resize.ts');
    expect(orphans).toContain('src/x.ts');
    expect(orphans).toContain('src/served.ts');
    expect(orphans).toContain('src/aliased.ts');
  });

  it('reads a template with no substitution as the plain import it is', () => {
    const orphans = orphansOf({
      'src/a.ts':
        'export const later = () => import(`./plain`);\nexport const now = require(`./required`);\n',
      'src/plain.ts': MODULE,
      'src/required.ts': MODULE,
    });
    expect(orphans).not.toContain('src/plain.ts');
    expect(orphans).not.toContain('src/required.ts');
  });

  it('does not count every file around the importer for a path that is only a hole there', () => {
    const orphans = orphansOf({
      'src/feature/loader.ts': [
        "import path from 'node:path';",
        'export const a = (name: string) => import(`./${name}`);',
        'export const b = (name: string) => import(path.join(__dirname, name));',
        'export const c = (name: string) => import(`../${name}`);',
        'export const d = (name: string) => import(`../../${name}`);',
      ].join('\n'),
      'src/feature/sibling.ts': MODULE,
      'src/feature/deep/child.ts': MODULE,
      'src/other.ts': MODULE,
      'top.ts': MODULE,
    });
    expect(orphans).toContain('src/feature/sibling.ts');
    expect(orphans).toContain('src/feature/deep/child.ts');
    expect(orphans).toContain('src/other.ts');
    expect(orphans).toContain('top.ts');
  });

  it('keeps an argument that is not written out as a hole where it stands', () => {
    const orphans = orphansOf({
      'src/jobs.ts': [
        "import path from 'node:path';",
        "export const run = (kind: string) => import(path.join(__dirname, 'jobs', kind, 'run.ts'));",
      ].join('\n'),
      'src/jobs/sync/run.ts': MODULE,
      'src/jobs/run.ts': MODULE,
    });
    expect(orphans).not.toContain('src/jobs/sync/run.ts');
    expect(orphans).toContain('src/jobs/run.ts');
  });

  it('follows only a single const: a reassignable or repeated name is not guessed', () => {
    const orphans = orphansOf({
      'src/run.ts': [
        "import path from 'node:path';",
        'export function one(name: string) {',
        '  let target = path.join(__dirname, "jobs", `${name}.ts`);',
        '  return import(target);',
        '}',
        'export function two(name: string) {',
        '  const file = path.join(__dirname, "steps", `${name}.ts`);',
        '  return import(file);',
        '}',
        'export function three(name: string) {',
        '  const file = path.join(__dirname, "other", `${name}.ts`);',
        '  return file;',
        '}',
      ].join('\n'),
      'src/jobs/sync.ts': MODULE,
      'src/steps/build.ts': MODULE,
    });
    expect(orphans).toContain('src/jobs/sync.ts');
    expect(orphans).toContain('src/steps/build.ts');
  });
});
