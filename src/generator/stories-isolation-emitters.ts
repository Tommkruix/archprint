import type { StoriesIsolationAnalysis } from '../detector/stories-isolation-detector.js';

export interface StoriesIsolationRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string };
  to: { path: string };
}

export interface StoriesIsolationConfig {
  forbidden: StoriesIsolationRule[];
}

const STORY_PATH = '\\.stories\\.(ts|tsx)$';

export function toDependencyCruiserStoriesIsolation(
  analysis: StoriesIsolationAnalysis,
): StoriesIsolationConfig {
  if (analysis.storyCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.storyCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'no-import-stories',
        comment: `Archprint inferred stories isolation: ${conform}/${analysis.storyCount} Storybook stories are loaded by Storybook and imported by nothing; importing a .stories file from other code is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { pathNot: STORY_PATH },
        to: { path: STORY_PATH },
      },
    ],
  };
}
