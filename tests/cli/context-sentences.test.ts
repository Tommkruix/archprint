import { describe, expect, it } from 'vitest';
import { appliesToApp, contextOwner } from '../../src/cli/check-context.js';
import { contextSentences, readsLikeRule } from '../../src/cli/context-sentences.js';

describe('contextSentences', () => {
  it('reads paragraphs, list items, quotes and table rows, each sentence with the line it starts on', () => {
    const markdown = [
      '# Conventions', //1
      '', //2
      'Packages are libraries. Apps import them.', //3
      '', //4
      '- Never import an app from a package,', //5
      '  not even for types.', //6
      '> Keep **pages** thin.', //7
      '', //8
      '| Do | Avoid |', //9
      '| --- | --- |', //10
      '| Use `zod` | Hand-written guards |', //11
    ].join('\n');
    expect(contextSentences(markdown)).toEqual([
      { text: 'Packages are libraries.', line: 3 },
      { text: 'Apps import them.', line: 3 },
      { text: 'Never import an app from a package, not even for types.', line: 5 },
      { text: 'Keep pages thin.', line: 7 },
      { text: 'Use zod Hand-written guards', line: 11 },
    ]);
  });

  it('starts a sentence on the continuation line it begins on', () => {
    expect(contextSentences('First sentence\ncontinues. Second\nsentence.')).toEqual([
      { text: 'First sentence continues.', line: 1 },
      { text: 'Second sentence.', line: 2 },
    ]);
  });

  it('leaves out headings, fenced and indented code, HTML and front matter', () => {
    const markdown = [
      '---',
      'description: |',
      '  Never read this.',
      '',
      '  Nor this.',
      'globs: src/**',
      '---',
      '## Never import the server',
      '```ts',
      'Never run this.',
      '```',
      '',
      '    Never this either.',
      '',
      '<!-- Never this comment. -->',
      '',
      'Only this counts.',
    ].join('\n');
    expect(contextSentences(markdown)).toEqual([{ text: 'Only this counts.', line: 17 }]);
  });

  it('reads nested list items, and not a setext heading or an HTML block', () => {
    const markdown = [
      'Never this heading',
      '===',
      '',
      '- Outer item.',
      '  - Inner item.',
      '',
      '<div>',
      'Never inside HTML.',
      '</div>',
      '',
      'Outside.',
    ].join('\n');
    expect(contextSentences(markdown)).toEqual([
      { text: 'Outer item.', line: 4 },
      { text: 'Inner item.', line: 5 },
      { text: 'Outside.', line: 11 },
    ]);
  });

  it('reads CRLF line endings the way it reads LF', () => {
    expect(contextSentences('First.\r\nSecond\r\nline.\r\n')).toEqual([
      { text: 'First.', line: 1 },
      { text: 'Second line.', line: 2 },
    ]);
  });

  it('does not end a sentence at an abbreviation', () => {
    expect(contextSentences('Use a schema library, e.g. zod, for input.')).toEqual([
      { text: 'Use a schema library, e.g. zod, for input.', line: 1 },
    ]);
  });
});

describe('readsLikeRule', () => {
  it.each([
    'Components should not call fetch.',
    'Never import an app from a package.',
    "Don't add a second query.",
    'Prefer export type for type-only symbols.',
  ])('reads an obligation word as a rule: %s', (sentence) => {
    expect(readsLikeRule(sentence)).toBe(true);
  });

  it.each([
    'Use the Twenty UI Dropdown for menus.',
    'When adding a column, use two migrations.',
    'If unsure, use the nx docs tool.',
    'For browser globals, add the listener in queueTask.',
  ])('reads an opening imperative, after an optional leading clause, as a rule: %s', (sentence) => {
    expect(readsLikeRule(sentence)).toBe(true);
  });

  it.each([
    'Packages are libraries.',
    'The build system uses the config from trigger.config.ts.',
    'Tests run in CI on every push.',
  ])('does not read a description as a rule: %s', (sentence) => {
    expect(readsLikeRule(sentence)).toBe(false);
  });
});

describe('which context files apply to an app', () => {
  it.each([
    ['CLAUDE.md', ''],
    ['apps/web/AGENTS.md', 'apps/web'],
    ['GEMINI.md', ''],
    ['.cursorrules', ''],
    ['.windsurfrules', ''],
    ['.cursor/rules/react.mdc', ''],
    ['apps/web/.cursor/rules/nested/forms.md', 'apps/web'],
    ['.github/copilot-instructions.md', ''],
    ['.github/instructions/api.instructions.md', ''],
  ])('%s speaks for the code under %j', (file, owner) => {
    expect(contextOwner(file)).toBe(owner);
  });

  it.each(['README.md', 'docs/agents.md', '.github/instructions/api.md', '.cursor/notes.mdc'])(
    'does not take %s for a context file',
    (file) => {
      expect(contextOwner(file)).toBeNull();
    },
  );

  it('applies a file in, below or above the app, and not one in a sibling', () => {
    expect(appliesToApp('', 'apps/web')).toBe(true);
    expect(appliesToApp('apps', 'apps/web')).toBe(true);
    expect(appliesToApp('apps/web', 'apps/web')).toBe(true);
    expect(appliesToApp('apps/web/src/server', 'apps/web')).toBe(true);
    expect(appliesToApp('apps/admin', 'apps/web')).toBe(false);
    expect(appliesToApp('apps/web-legacy', 'apps/web')).toBe(false);
    expect(appliesToApp('apps/admin', '')).toBe(true);
  });
});
