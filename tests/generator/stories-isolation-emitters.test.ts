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
