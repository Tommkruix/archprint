import { describe, expect, it } from 'vitest';
import { findRule, ruleKey, ruleNames } from '../../src/cli/rule-ref.js';

const rules = [
  { id: 'AP-002', label: 'AP-002' },
  { id: 'no-lib-to-components', label: 'lib !-> components' },
  { id: 'workspace-package', label: 'workspace-package-api' },
];

describe('rule references', () => {
  it('finds a rule by its id, ESLint name or label, in any case and spacing', () => {
    for (const ref of [
      'no-lib-to-components',
      'archprint/no-lib-to-components',
      'lib !-> components',
      '  LIB  !->  Components ',
    ]) {
      expect(findRule(ref, rules)?.id, ref).toBe('no-lib-to-components');
    }
    expect(findRule('workspace-package-api', rules)?.id).toBe('workspace-package');
    expect(findRule('ap-002', rules)?.id).toBe('AP-002');
    expect(findRule('archprint/no-ui-layer-in-server-entry', rules)?.id).toBe('AP-002');
  });

  it('finds nothing for a name no rule carries', () => {
    expect(findRule('no-lib-to-app', rules)).toBeUndefined();
    expect(findRule('archprint/', rules)).toBeUndefined();
  });

  it('keys a reference the way --rules reads it', () => {
    expect(ruleKey(' Archprint/No-Lib-To-App ')).toBe('no-lib-to-app');
  });

  it('lists each id and distinct label once', () => {
    expect(ruleNames(rules)).toEqual([
      'AP-002',
      'no-lib-to-components',
      'lib !-> components',
      'workspace-package',
      'workspace-package-api',
    ]);
  });
});
