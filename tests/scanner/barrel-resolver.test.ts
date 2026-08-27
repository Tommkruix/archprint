import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isBarrelFile, resolveToLeafFiles } from '../../src/scanner/barrel-resolver.js';

function leafNames(project: Project, entry: string): string[] {
  const sf = project.getSourceFileOrThrow(entry);
  return resolveToLeafFiles(sf)
    .map((f) => f.getBaseName())
    .sort();
}

function makeProject() {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('a.ts', 'export function a() {}');
  project.createSourceFile('b.ts', 'export const b = 1;');
  project.createSourceFile('index.ts', "export * from './a';\nexport { b } from './b';");
  project.createSourceFile('outer.ts', "export * from './index';");
  project.createSourceFile('mixed.ts', "export * from './a';\nexport function extra() {}");
  return project;
}

describe('isBarrelFile', () => {
  it('is true for a pure re-export index', () => {
    const project = makeProject();
    expect(isBarrelFile(project.getSourceFileOrThrow('index.ts'))).toBe(true);
  });

  it('is false for a leaf module with no re-exports', () => {
    const project = makeProject();
    expect(isBarrelFile(project.getSourceFileOrThrow('a.ts'))).toBe(false);
  });

  it('is false for a file that re-exports but also declares its own values', () => {
    const project = makeProject();
    expect(isBarrelFile(project.getSourceFileOrThrow('mixed.ts'))).toBe(false);
  });
});

describe('resolveToLeafFiles', () => {
  it('resolves a barrel to its leaf modules', () => {
    const project = makeProject();
    expect(leafNames(project, 'index.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('resolves through nested barrels', () => {
    const project = makeProject();
    expect(leafNames(project, 'outer.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('resolves a leaf module to itself', () => {
    const project = makeProject();
    expect(leafNames(project, 'a.ts')).toEqual(['a.ts']);
  });

  it('does not infinite-loop on a re-export cycle', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('x.ts', "export * from './y';");
    project.createSourceFile('y.ts', "export * from './x';");
    expect(leafNames(project, 'x.ts')).toEqual([]);
  });
});
