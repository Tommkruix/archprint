import { describe, expect, it } from 'vitest';
import type { AdoptedRule } from '../../src/cli/adopted-rules.js';
import type { Finding } from '../../src/cli/check-evaluate.js';
import { describeBurnDown, exceptionBurnDown } from '../../src/cli/check-exceptions.js';

const entryRule = {
  id: 'no-import-framework-entry',
  family: 'entry-purity',
  statement: 'framework entries must not be imported by other code',
  mode: 'deep',
  evidence: { conforming: 40, total: 42, floor: 0.9 },
  exceptions: ['src/lib/a.ts -> app/page.tsx', 'src/lib/b.ts -> app/page.tsx'],
} as AdoptedRule;
const entryImport = (importer: string): Finding => ({
  ruleId: entryRule.id,
  file: importer,
  subject: 'app/page.tsx',
  kind: 'target',
});

describe('exception burn-down', () => {
  it('keys entry-purity exceptions by import, and follows a renamed importer', () => {
    const burnDown = exceptionBurnDown(
      [entryRule],
      [entryRule],
      [entryImport('src/lib/a.ts'), entryImport('src/lib/b.ts')],
      [entryImport('src/lib/renamed-a.ts')],
      new Map([['src/lib/a.ts', 'src/lib/renamed-a.ts']]),
    );
    expect(burnDown.left).toBe(1);
    expect(burnDown.fixedInChange).toEqual([
      { rule: entryRule.id, exceptions: ['src/lib/b.ts -> app/page.tsx'] },
    ]);
  });

  it('does not count as fixed in the change an exception that already did not break on the base', () => {
    const burnDown = exceptionBurnDown([entryRule], [entryRule], [], [], new Map());
    expect(burnDown.fixedInChange).toEqual([]);
    expect(burnDown.stillRecorded).toEqual([
      { rule: entryRule.id, exceptions: entryRule.exceptions },
    ]);
  });

  it('counts the files a freeze rule allows apart from the exceptions left to fix', () => {
    const freeze = {
      id: 'doc-freeze-ui',
      family: 'declared',
      template: 'forbid-file',
      files: ['src/components/ui/**'],
      except: [],
      root: '..',
      source: { file: 'CLAUDE.md', line: 99 },
      statement: 'Do not add new primitives here.',
      mode: 'fast',
      evidence: { conforming: 0, total: 2, floor: 0 },
      exceptions: ['src/components/ui/button.tsx', 'src/components/ui/card.tsx'],
    } as AdoptedRule;
    const consoleRule = {
      id: 'console-isolation',
      family: 'console-isolation',
      statement: 'library code must not use console',
      mode: 'fast',
      evidence: { conforming: 40, total: 41, floor: 0.9 },
      exceptions: ['src/lib/storage.ts'],
    } as AdoptedRule;
    const findings: Finding[] = [
      ...freeze.exceptions!.map((file) => ({
        ruleId: freeze.id,
        file,
        subject: file,
        kind: 'target' as const,
      })),
      { ruleId: consoleRule.id, file: 'src/lib/storage.ts', subject: 'console', kind: 'usage' },
    ];
    const burnDown = exceptionBurnDown(
      [freeze, consoleRule],
      [freeze, consoleRule],
      findings,
      findings,
      new Map(),
    );
    expect(burnDown).toMatchObject({ left: 1, frozen: 2 });
    expect(describeBurnDown(burnDown)).toEqual([
      'Exceptions: 1 left. Not counted: 2 file(s) a freeze rule allows as they are.',
    ]);
  });

  it('still says how many files a freeze rule allows when no other exception is left', () => {
    expect(describeBurnDown({ left: 0, frozen: 38, fixedInChange: [], stillRecorded: [] })).toEqual(
      ['Exceptions: 0 left. Not counted: 38 file(s) a freeze rule allows as they are.'],
    );
  });

  it('says nothing when no rule records an exception', () => {
    expect(describeBurnDown({ left: 0, frozen: 0, fixedInChange: [], stillRecorded: [] })).toEqual(
      [],
    );
  });
});
