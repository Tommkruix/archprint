import { describe, expect, it } from 'vitest';
import {
  type StoriesIsolationAnalysis,
  evaluateGate,
  toDependencyCruiserStoriesIsolation,
} from '../../src/index.js';

function analysis(storyCount: number, offenderCount: number): StoriesIsolationAnalysis {
  return {
    appDir: 'x',
    storyCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: storyCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserStoriesIsolation', () => {
  it('emits a rule forbidding imports of .stories files when clean (AUTO)', () => {
    const config = toDependencyCruiserStoriesIsolation(analysis(40, 0));
    expect(config.forbidden).toHaveLength(1);
    expect(config.forbidden[0]!.name).toBe('no-import-stories');
    expect(config.forbidden[0]!.to.path).toContain('stories');
  });

  it('emits nothing with no stories or below AUTO', () => {
    expect(toDependencyCruiserStoriesIsolation(analysis(0, 0)).forbidden).toEqual([]);
    expect(toDependencyCruiserStoriesIsolation(analysis(5, 3)).forbidden).toEqual([]);
  });
});

describe('toDependencyCruiserStoriesIsolation exemptions', () => {
  it('exempts the files that import a story, known or allowed, not the stories', () => {
    const known = {
      ...analysis(200, 1),
      violations: [{ file: 'src/Button.stories.tsx', importer: 'src/app.tsx' }],
    };
    const allowed = (rule: string) => (rule === 'no-import-stories' ? ['src/docs.tsx'] : []);
    const [rule] = toDependencyCruiserStoriesIsolation(known, allowed).forbidden;
    expect(rule!.from.pathNot).toEqual([
      '\\.stories\\.(ts|tsx)$',
      '(^|/)src/app\\.tsx$',
      '(^|/)src/docs\\.tsx$',
    ]);
  });
});
