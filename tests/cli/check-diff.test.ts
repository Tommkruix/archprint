import { describe, expect, it } from 'vitest';
import { ruleDefinitionKey, type AdoptedRule } from '../../src/cli/adopted-rules.js';
import { diffFindings, partitionRules, renameFinding } from '../../src/cli/check-diff.js';
import type { Finding } from '../../src/cli/check-evaluate.js';

const evidence = { conforming: 40, total: 40, floor: 0.91 };

const consoleRule: AdoptedRule = {
  id: 'console-isolation',
  family: 'console-isolation',
  statement: 'library code must not use console',
  mode: 'fast',
  evidence,
};

const dbRule = (markers: string[]): AdoptedRule => ({
  id: 'AP-001',
  family: 'forbidden-imports',
  statement: 'A request-entry file must not import the database client directly.',
  mode: 'deep',
  roles: ['ROUTE_HANDLER'],
  forbidden: markers.map((source) => ({ source, flags: '' })),
  evidence,
});

const finding = (overrides: Partial<Finding>): Finding => ({
  ruleId: 'AP-001',
  file: 'app/api/users/route.ts',
  subject: '@/lib/db',
  kind: 'specifier',
  ...overrides,
});

describe('ruleDefinitionKey', () => {
  it('ignores evidence and wording, so re-measuring a rule does not count as changing it', () => {
    const remeasured = {
      ...consoleRule,
      statement: 'reworded',
      evidence: { conforming: 1, total: 2, floor: 0.1 },
    };
    expect(ruleDefinitionKey(remeasured)).toBe(ruleDefinitionKey(consoleRule));
  });

  it('changes when what the rule forbids changes', () => {
    expect(ruleDefinitionKey(dbRule(['drizzle-orm']))).not.toBe(
      ruleDefinitionKey(dbRule(['@prisma\\/client'])),
    );
  });

  it('does not depend on the order fields or markers were written in', () => {
    const reordered = {
      evidence,
      forbidden: [
        { flags: '', source: 'b' },
        { flags: '', source: 'a' },
      ],
      roles: ['ROUTE_HANDLER'],
      mode: 'deep',
      statement: 's',
      family: 'forbidden-imports',
      id: 'AP-001',
    } as AdoptedRule;
    expect(ruleDefinitionKey(reordered)).toBe(ruleDefinitionKey(dbRule(['a', 'b'])));
  });

  it('changes when the resolution mode changes', () => {
    expect(ruleDefinitionKey({ ...consoleRule, mode: 'deep' })).not.toBe(
      ruleDefinitionKey(consoleRule),
    );
  });
});

describe('partitionRules', () => {
  it('compares a rule only when the base adopted the same definition', () => {
    const partition = partitionRules([consoleRule, dbRule(['drizzle-orm'])], [consoleRule]);
    expect(partition.comparable.map((rule) => rule.id)).toEqual(['console-isolation']);
    expect(partition.adoptedInChange).toEqual([{ rule: dbRule(['drizzle-orm']), change: 'new' }]);
  });

  it('marks a rule whose definition changed in the change, never comparing it', () => {
    const partition = partitionRules([dbRule(['drizzle-orm'])], [dbRule(['@prisma\\/client'])]);
    expect(partition.comparable).toEqual([]);
    expect(partition.adoptedInChange[0]!.change).toBe('changed');
  });

  it('lists rules the change removed, so deleting a rule is visible', () => {
    const partition = partitionRules([consoleRule], [consoleRule, dbRule(['drizzle-orm'])]);
    expect(partition.removedInChange.map((rule) => rule.id)).toEqual(['AP-001']);
  });

  it('treats every rule as newly adopted when the base has no rules file', () => {
    expect(partitionRules([consoleRule], null).adoptedInChange[0]!.change).toBe('new');
  });
});

describe('diffFindings', () => {
  it('reports only findings the head adds, and the ones it removes as fixed', () => {
    const kept = finding({ file: 'app/a/route.ts' });
    const removed = finding({ file: 'app/b/route.ts' });
    const added = finding({ file: 'app/c/route.ts' });
    const diff = diffFindings([kept, removed], [kept, added], new Map());
    expect(diff.introduced).toEqual([added]);
    expect(diff.fixed).toEqual([removed]);
  });

  it('does not report an existing violation as new when its file was renamed', () => {
    const before = finding({
      ruleId: 'console-isolation',
      kind: 'file',
      subject: '',
      file: 'lib/log.ts',
    });
    const after = { ...before, file: 'lib/logger.ts' };
    const renames = new Map([['lib/log.ts', 'lib/logger.ts']]);
    expect(diffFindings([before], [after], renames).introduced).toEqual([]);
    expect(diffFindings([before], [after], new Map()).introduced).toEqual([after]);
  });

  it('maps a renamed target for target-based rules but never rewrites an import specifier', () => {
    const renames = new Map([['src/a.test.ts', 'src/b.test.ts']]);
    const target = finding({ ruleId: 'test-isolation', kind: 'target', subject: 'src/a.test.ts' });
    const specifier = finding({ subject: 'src/a.test.ts' });
    expect(renameFinding(target, renames).subject).toBe('src/b.test.ts');
    expect(renameFinding(specifier, renames).subject).toBe('src/a.test.ts');
  });

  it('lists several new violations in a stable order, whatever order the scan found them in', () => {
    const b = finding({ file: 'app/b/route.ts' });
    const a = finding({ file: 'app/a/route.ts' });
    expect(diffFindings([], [b, a], new Map()).introduced).toEqual([a, b]);
    expect(diffFindings([b, a], [], new Map()).fixed).toEqual([a, b]);
  });

  it('distinguishes two violations in one file by what they import', () => {
    const first = finding({ subject: '@/lib/db' });
    const second = finding({ subject: '@prisma/client' });
    expect(diffFindings([first], [first, second], new Map()).introduced).toEqual([second]);
  });
});
