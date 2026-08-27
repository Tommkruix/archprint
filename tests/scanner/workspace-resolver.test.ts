import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceMap } from '../../src/scanner/workspace-resolver.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name: string): string => path.join(fixturesDir, name);

describe('buildWorkspaceMap', () => {
  it('resolves aliases to absolute paths relative to baseUrl', () => {
    const dir = fixture('basic');
    const map = buildWorkspaceMap(dir);

    expect(map['@app']).toBe(path.resolve(dir, 'src'));
    expect(map['@db']).toBe(path.resolve(dir, 'packages/db/index.ts'));
    for (const target of Object.values(map)) {
      expect(path.isAbsolute(target)).toBe(true);
    }
  });

  it('parses JSON with comments and trailing commas', () => {
    const dir = fixture('comments');
    const map = buildWorkspaceMap(dir);

    expect(map['@x']).toBe(path.resolve(dir, 'lib'));
  });

  it('follows extends chains to a parent config that declares the paths', () => {
    const dir = fixture('extends');
    const map = buildWorkspaceMap(dir);

    expect(map['@shared']).toBe(path.resolve(dir, 'configs', 'shared'));
  });

  it('returns an empty map when no paths are declared', () => {
    expect(buildWorkspaceMap(fixture('no-paths'))).toEqual({});
  });

  it('returns an empty map when no tsconfig exists', () => {
    expect(buildWorkspaceMap(fixture('does-not-exist'))).toEqual({});
  });
});
