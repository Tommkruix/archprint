import { describe, expect, it } from 'vitest';
import type { AdoptedRule } from '../../src/cli/adopted-rules.js';
import {
  checkExitCode,
  checkJson,
  findingMessage,
  githubAnnotations,
  githubSummary,
  renderCheckText,
  type CheckResult,
  type ReportedFinding,
} from '../../src/cli/check.js';

const rule: AdoptedRule = {
  id: 'AP-001',
  family: 'forbidden-imports',
  statement: 'A request handler must not import the database client directly.',
  mode: 'deep',
  roles: ['ROUTE_HANDLER'],
  forbidden: [{ source: 'drizzle-orm', flags: '' }],
  evidence: { conforming: 40, total: 40, floor: 0.9124 },
};

const reported = (overrides: Partial<ReportedFinding> = {}): ReportedFinding => ({
  ruleId: 'AP-001',
  file: 'app/api/users/route.ts',
  subject: '@/lib/db',
  kind: 'specifier',
  line: 2,
  rule,
  ...overrides,
});

const checked = (
  overrides: Partial<Extract<CheckResult, { status: 'checked' }>> = {},
): CheckResult => ({
  status: 'checked',
  base: 'main',
  commit: '97cefaf986aa51f3c7953afecd6fe4fb87beebd1',
  appPath: '',
  rules: [rule],
  introduced: [reported()],
  fixed: [],
  adoptedInChange: [],
  removedInChange: [],
  ...overrides,
});

const skipped: CheckResult = { status: 'skipped', reason: 'no .archprint/rules.json' };

describe('findingMessage', () => {
  it('states the rule and the evidence recorded when the rule was adopted', () => {
    expect(findingMessage(rule)).toBe(
      'A request handler must not import the database client directly. When this rule was adopted, 40 of 40 files it applies to followed it (confidence 91%).',
    );
  });

  it('capitalizes a lowercase statement and adds the full stop itself', () => {
    const lower = { ...rule, statement: 'library code must not use console' };
    expect(findingMessage(lower)).toMatch(/^Library code must not use console\. When/);
  });
});

describe('checkExitCode', () => {
  it('fails only on new violations, and only when asked to', () => {
    expect(checkExitCode(checked(), 'new')).toBe(1);
    expect(checkExitCode(checked(), 'none')).toBe(0);
    expect(checkExitCode(checked({ introduced: [] }), 'new')).toBe(0);
  });

  it('never fails when the check did not run, so the notice is the signal', () => {
    expect(checkExitCode(skipped, 'new')).toBe(0);
  });
});

describe('githubAnnotations', () => {
  it('emits a warning by default and an error when failing on new violations', () => {
    expect(githubAnnotations(checked(), 'none')[0]).toMatch(/^::warning /);
    expect(githubAnnotations(checked(), 'new')[0]).toMatch(/^::error /);
  });

  it('points at the repo-relative file and line and escapes the workflow-command syntax', () => {
    const percent = { ...rule, statement: 'Keep coverage at 100%' };
    const [line] = githubAnnotations(
      checked({ appPath: 'apps/web', introduced: [reported({ rule: percent })] }),
      'none',
    );
    expect(line).toBe(
      '::warning file=apps/web/app/api/users/route.ts,line=2,title=archprint%3A AP-001::Keep coverage at 100%25. When this rule was adopted, 40 of 40 files it applies to followed it (confidence 91%25).',
    );
  });

  it('escapes commas and newlines in a property value', () => {
    const [line] = githubAnnotations(
      checked({ introduced: [reported({ file: 'a,b\nc.ts' })] }),
      'none',
    );
    expect(line).toContain('file=a%2Cb%0Ac.ts');
  });

  it('omits the line when it could not be located with certainty', () => {
    const [line] = githubAnnotations(checked({ introduced: [reported({ line: null })] }), 'none');
    expect(line).not.toContain('line=');
  });

  it('turns a skipped check into a visible notice', () => {
    expect(githubAnnotations(skipped, 'new')).toEqual([
      '::notice title=archprint check did not run::no .archprint/rules.json',
    ]);
  });
});

describe('githubSummary and text', () => {
  it('lists new violations with their location and evidence', () => {
    const summary = githubSummary(checked());
    expect(summary).toContain('**1 new violation(s):**');
    expect(summary).toContain('| `app/api/users/route.ts:2` | AP-001 |');
  });

  it('says plainly when there is nothing new, and reports fixes and rules adopted in the change', () => {
    const summary = githubSummary(
      checked({
        introduced: [],
        fixed: [reported({ line: null })],
        adoptedInChange: [{ rule, change: 'new', count: 3 }],
      }),
    );
    expect(summary).toContain('No new violations.');
    expect(summary).toContain('Fixed: 1 violation(s) removed.');
    expect(summary).toContain('its 3 existing violation(s) are not counted');
  });

  it('renders the skip reason in the summary and the text', () => {
    expect(githubSummary(skipped)).toContain('archprint check did not run');
    expect(renderCheckText(skipped)).toBe('archprint check did not run: no .archprint/rules.json');
  });

  it('renders text with the location, the rule and changed rules', () => {
    const text = renderCheckText(
      checked({ adoptedInChange: [{ rule, change: 'changed', count: 0 }], fixed: [reported()] }),
    );
    expect(text).toContain('app/api/users/route.ts:2  AP-001 (@/lib/db)');
    expect(text).toContain('Fixed: 1 violation(s) removed.');
    expect(text).toContain('Rule AP-001 was changed in this change');
    expect(renderCheckText(checked({ introduced: [] }))).toContain('No new violations.');
  });

  it('renders a file-level finding without a line or subject', () => {
    const text = renderCheckText(
      checked({ introduced: [reported({ kind: 'file', subject: '', line: null })] }),
    );
    expect(text).toContain('  app/api/users/route.ts  AP-001\n');
  });
});

describe('rules removed in the change', () => {
  it('is reported in the text, the summary and the JSON, so dropping a rule is never silent', () => {
    const result = checked({ introduced: [], removedInChange: [rule] });
    expect(renderCheckText(result)).toContain('Rule AP-001 was removed in this change');
    expect(githubSummary(result)).toContain('Rule `AP-001` was **removed** in this change');
    expect(checkJson(result, '9.9.9')).toMatchObject({ removedInChange: ['AP-001'] });
  });
});

describe('summary table safety', () => {
  it('escapes pipes and newlines so a rule text cannot break the table', () => {
    const odd = { ...rule, id: 'AP|9', statement: 'one | two\nthree' };
    const summary = githubSummary(checked({ introduced: [reported({ rule: odd })] }));
    expect(summary).toContain('| AP\\|9 | One \\| two three.');
  });
});

describe('checkJson', () => {
  it('is version-keyed and lists introduced findings with their line and message', () => {
    const json = checkJson(checked(), '9.9.9') as { introduced: { line: number; rule: string }[] };
    expect(json).toMatchObject({
      archprintVersion: '9.9.9',
      status: 'checked',
      app: '.',
      base: 'main',
    });
    expect(json.introduced[0]).toMatchObject({ rule: 'AP-001', line: 2, subject: '@/lib/db' });
  });

  it('reports a skip with its reason, and null subjects for file-level findings', () => {
    expect(checkJson(skipped, '9.9.9')).toEqual({
      archprintVersion: '9.9.9',
      status: 'skipped',
      reason: 'no .archprint/rules.json',
    });
    const json = checkJson(
      checked({
        introduced: [reported({ kind: 'file', subject: '' })],
        adoptedInChange: [{ rule, change: 'new', count: 2 }],
      }),
      '9.9.9',
    ) as { introduced: { subject: null }[]; adoptedInChange: unknown[] };
    expect(json.introduced[0]!.subject).toBeNull();
    expect(json.adoptedInChange).toEqual([
      { rule: 'AP-001', change: 'new', existingViolations: 2 },
    ]);
  });
});

describe('a change that removes the adopted rules', () => {
  const removed: CheckResult = {
    status: 'rules-removed',
    base: 'main',
    commit: '97cefaf986aa51f3c7953afecd6fe4fb87beebd1',
    missingFile: '.archprint/rules.json',
    removed: [rule],
  };
  const message =
    'This change removes .archprint/rules.json, so the 1 rule(s) adopted on the base commit are no longer checked: AP-001.';

  it('says which rules stop being checked in every format, and never fails the job', () => {
    expect(renderCheckText(removed)).toBe(`archprint check: ${message}`);
    expect(githubAnnotations(removed, 'new')).toEqual([
      `::warning file=.archprint/rules.json,title=archprint rules removed::${message}`,
    ]);
    expect(githubSummary(removed)).toContain(message);
    expect(checkJson(removed, '9.9.9')).toEqual({
      archprintVersion: '9.9.9',
      status: 'rules-removed',
      base: 'main',
      commit: removed.commit,
      missingFile: '.archprint/rules.json',
      removedInChange: ['AP-001'],
    });
    expect(checkExitCode(removed, 'new')).toBe(0);
  });
});
