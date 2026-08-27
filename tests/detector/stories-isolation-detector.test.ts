import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectStoriesIsolation } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'stories-isolation');

describe('detectStoriesIsolation', () => {
  it('flags Storybook stories imported by non-story code, sorted', () => {
    const analysis = detectStoriesIsolation(fixture);
    expect(analysis.storyCount).toBe(2);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/button.stories.tsx', importer: 'src/gallery.ts' },
      { file: 'src/card.stories.tsx', importer: 'src/gallery.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectStoriesIsolation(relative).offenderCount).toBe(2);
  });

  it('reports no stories when there are none', () => {
    const analysis = detectStoriesIsolation(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.storyCount).toBe(0);
    expect(analysis.offenderCount).toBe(0);
  });
});
