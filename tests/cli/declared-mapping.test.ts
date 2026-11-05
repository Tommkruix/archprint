import { describe, expect, it } from 'vitest';
import {
  declaredRuleId,
  MappingError,
  parseMapping,
  parseMappingJson,
} from '../../src/cli/declared-mapping.js';

const source = { file: 'CLAUDE.md', quote: 'Never call fetch in a component' };
const usageRule = {
  template: 'forbid-usage',
  source,
  name: 'no-fetch-in-components',
  files: ['src/components/**'],
  usage: ['fetch'],
};

const reasonOf = (entry: unknown): string => {
  const [parsed] = parseMapping({ rules: [entry] });
  if (parsed === undefined || !('invalid' in parsed)) throw new Error('expected an invalid entry');
  return parsed.invalid;
};

describe('parseMapping', () => {
  it('reads each template, with except defaulting to none', () => {
    const parsed = parseMapping({
      rules: [
        usageRule,
        {
          template: 'forbid-import',
          source,
          name: 'no-unstable-cache',
          files: ['**'],
          packages: [{ name: 'next/cache', imports: ['unstable_cache'] }],
        },
        {
          template: 'forbid-file',
          source,
          name: 'freeze-ui',
          files: ['src/ui/**'],
          except: ['src/ui/index.ts'],
        },
        { template: 'inferred', source, rule: 'import-style' },
        { template: 'none', source, reason: 'generic lint' },
      ],
    });
    expect(parsed).toEqual([
      { sentence: { ...usageRule, except: [] } },
      {
        sentence: {
          template: 'forbid-import',
          source,
          name: 'no-unstable-cache',
          files: ['**'],
          except: [],
          targets: [],
          packages: [{ name: 'next/cache', imports: ['unstable_cache'] }],
        },
      },
      {
        sentence: {
          template: 'forbid-file',
          source,
          name: 'freeze-ui',
          files: ['src/ui/**'],
          except: ['src/ui/index.ts'],
        },
      },
      { sentence: { template: 'inferred', source, rule: 'import-style' } },
      { sentence: { template: 'none', source, reason: 'generic lint' } },
    ]);
  });

  it('keeps a malformed entry as invalid, with its reason and source, and still reads the rest', () => {
    const parsed = parseMapping({ rules: [{ ...usageRule, usage: ['fetch()'] }, usageRule] });
    expect(parsed[0]).toEqual({
      invalid: expect.stringContaining('"usage" holds "fetch()"'),
      source,
    });
    expect(parsed[1]).toEqual({ sentence: { ...usageRule, except: [] } });
  });

  it('refuses a name that is not kebab-case, or used twice', () => {
    expect(reasonOf({ ...usageRule, name: 'NoFetch' })).toContain('"name" must be lowercase words');
    const parsed = parseMapping({ rules: [usageRule, usageRule] });
    expect(parsed[1]).toEqual({
      invalid: 'the name "no-fetch-in-components" is used twice',
      source,
    });
  });

  it('refuses globs that leave the repository or use backslashes', () => {
    expect(reasonOf({ ...usageRule, files: ['../other/**'] })).toContain(
      'relative to the repository',
    );
    expect(reasonOf({ ...usageRule, except: ['/abs/**'] })).toContain('relative to the repository');
    expect(reasonOf({ ...usageRule, files: ['src\\components'] })).toContain('forward slashes');
  });

  it('refuses a negated or comment glob, pointing at except', () => {
    expect(reasonOf({ ...usageRule, files: ['!src/legacy/**'] })).toBe(
      '"files" holds "!src/legacy/**"; list what to leave out in "except" instead of negating a glob',
    );
    expect(reasonOf({ ...usageRule, except: ['#src'] })).toContain('instead of negating a glob');
  });

  it('refuses a field the template does not take, so a misspelled one is not silently dropped', () => {
    expect(reasonOf({ ...usageRule, targets: ['src/db/**'] })).toBe(
      '"forbid-usage" takes no "targets"',
    );
  });

  it('needs targets or packages for forbid-import, and export names for package imports', () => {
    const importRule = { template: 'forbid-import', source, name: 'x-rule', files: ['**'] };
    expect(reasonOf(importRule)).toBe('"forbid-import" needs "targets" or "packages"');
    expect(
      reasonOf({ ...importRule, packages: [{ name: 'next/cache', imports: ['a-b'] }] }),
    ).toContain('not an export name');
    expect(reasonOf({ ...importRule, packages: ['lodash'] })).toContain('"packages[0]" must be');
  });

  it('needs a quote long enough to find, and caps list and text lengths', () => {
    expect(reasonOf({ ...usageRule, source: { file: 'CLAUDE.md', quote: 'no fetch' } })).toContain(
      'at least 10 characters',
    );
    expect(
      reasonOf({ ...usageRule, files: Array.from({ length: 21 }, (_, i) => `src/${i}/**`) }),
    ).toContain('more than 20 items');
    expect(reasonOf({ ...usageRule, files: [`${'a/'.repeat(101)}**`] })).toContain(
      'longer than 200 characters',
    );
    expect(reasonOf({ template: 'nope', source })).toContain('"template" must be one of');
    expect(reasonOf({ template: 'none', source: 'CLAUDE.md' })).toContain('"source" must be');
  });

  it('throws on a mapping that is not { rules: [...] }, is empty, or is too long', () => {
    expect(() => parseMapping([])).toThrow(MappingError);
    expect(() => parseMapping({ rules: [] })).toThrow('The mapping has no rules.');
    expect(() => parseMapping({ rules: Array.from({ length: 201 }, () => usageRule) })).toThrow(
      'more than 200 rules',
    );
  });
});

describe('parseMappingJson', () => {
  it('reads JSON and names a parse error as a mapping error', () => {
    expect(parseMappingJson('{"rules":[]}')).toEqual({ rules: [] });
    expect(() => parseMappingJson('{"rules":')).toThrow(MappingError);
  });
});

describe('declaredRuleId', () => {
  it('puts a team rule under doc-, a namespace no inferred rule uses', () => {
    expect(declaredRuleId('no-fetch-in-components')).toBe('doc-no-fetch-in-components');
  });
});
