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

  it('says nothing when no rule records an exception', () => {
    expect(describeBurnDown({ left: 0, fixedInChange: [], stillRecorded: [] })).toEqual([]);
  });
});
