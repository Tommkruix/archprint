import type { StoriesIsolationAnalysis } from '../detector/stories-isolation-detector.js';
import {
  type AllowedFor,
  exemptDepcruiseFrom,
  noneAllowed,
  toleratedFiles,
} from './depcruise-exempt.js';

export interface StoriesIsolationRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string | string[] };
  to: { path: string };
}

export interface StoriesIsolationConfig {
  forbidden: StoriesIsolationRule[];
}

export const STORIES_ISOLATION_RULE = 'no-import-stories';

const STORY_PATH = '\\.stories\\.(ts|tsx)$';

export function toDependencyCruiserStoriesIsolation(
  analysis: StoriesIsolationAnalysis,
  appPath = '.',
  allowedFor: AllowedFor = noneAllowed,
): StoriesIsolationConfig {
  if (analysis.storyCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.storyCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: STORIES_ISOLATION_RULE,
        comment: `Archprint inferred stories isolation: ${conform}/${analysis.storyCount} Storybook stories are loaded by Storybook and imported by nothing; importing a .stories file from other code is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: {
          pathNot: exemptDepcruiseFrom(
            STORY_PATH,
            toleratedFiles(
              analysis.violations.map((story) => ({ file: story.importer })),
              allowedFor(STORIES_ISOLATION_RULE),
            ),
            appPath,
          ),
        },
        to: { path: STORY_PATH },
      },
    ],
  };
}
