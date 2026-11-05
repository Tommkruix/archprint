import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { analyzeImports } from '../../src/scanner/file-walker.js';
import { buildWorkspaceMap } from '../../src/scanner/workspace-resolver.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);

const leavesOf = (appDir: string, file: string, specifier: string): string[] =>
  analyzeImports(appDir, path.join(appDir, file))
    .filter((imp) => imp.specifier === specifier)
    .flatMap((imp) => imp.valueLeafPaths)
    .map((leaf) => path.relative(appDir, leaf).split(path.sep).join('/'));

describe('aliases from tsconfig project references', () => {
  const solution = fixture('references-solution');

  it('reads the aliases of the referenced project that compiles the files of a solution tsconfig', () => {
    expect(buildWorkspaceMap(solution)['@']).toBe(path.resolve(solution, 'src'));
  });

  it('sees imports through those aliases, so their targets are not orphans', () => {
    const { orphans } = detectOrphans(solution);
    expect(orphans).not.toContain('src/components/button.tsx');
    expect(orphans).toContain('src/lib/unused.ts');
  });

  it('resolves them in deep mode with the owning project compiler options', () => {
    expect(leavesOf(solution, 'src/main.tsx', '@/components/button')).toEqual([
      'src/components/button.tsx',
    ]);
  });

  it('resolves a relative .tsx import in deep mode, which needs the owning project jsx option', () => {
    expect(leavesOf(solution, 'src/main.tsx', './components/card')).toEqual([
      'src/components/card.tsx',
    ]);
  });

  it('resolves a file no project includes with the root config in deep mode, as TypeScript would not resolve it', () => {
    expect(leavesOf(solution, 'scripts/seed.ts', '@/components/button')).toEqual([]);
  });

  it('keeps the root config mapping when a reference maps the same alias elsewhere', () => {
    const dir = fixture('references-root-wins');
    const map = buildWorkspaceMap(dir);
    expect(map['@']).toBe(path.resolve(dir, 'lib'));
    expect(map['~']).toBe(path.resolve(dir, 'src'));
  });

  it('leaves out an alias two references map to different directories', () => {
    expect(buildWorkspaceMap(fixture('references-ambiguous'))['@']).toBeUndefined();
  });

  it('resolves each file in deep mode with the project that owns it, the first reference for a shared file', () => {
    const dir = fixture('references-ambiguous');
    expect(leavesOf(dir, 'src/app/main.ts', '@/view')).toEqual(['src/app/view.ts']);
    expect(leavesOf(dir, 'src/worker/main.ts', '@/job')).toEqual(['src/worker/job.ts']);
    expect(leavesOf(dir, 'src/shared/format.ts', '@/view')).toEqual(['src/app/view.ts']);
  });

  it('ignores a reference whose files belong to a nested tsconfig, and a reference that does not exist', () => {
    const dir = fixture('references-monorepo');
    expect(buildWorkspaceMap(dir)['@']).toBeUndefined();
    expect(buildWorkspaceMap(path.join(dir, 'packages', 'web'))['@']).toBe(
      path.resolve(dir, 'packages', 'web', 'src'),
    );
  });

  it('ignores a reference that only includes files outside the directory', () => {
    const web = path.join(fixture('references-monorepo'), 'packages', 'web');
    expect(buildWorkspaceMap(web)['#common']).toBeUndefined();
  });
});
