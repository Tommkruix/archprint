import { describe, expect, it } from 'vitest';
import { type BoundaryRule, renderTsArchTests } from '../../src/index.js';

const rule: BoundaryRule = {
  name: 'no-utils-to-components',
  comment: 'Archprint inferred boundary: utils must not depend on components.',
  from: { path: '(^|/)utils/' },
  to: { path: '(^|/)components/' },
};

describe('renderTsArchTests', () => {
  it('renders a runnable ts-arch test per boundary', () => {
    const out = renderTsArchTests([rule]);
    expect(out).toContain("import { filesOfProject } from 'tsarch';");
    expect(out).toContain("import { describe, expect, it } from 'vitest';");
    expect(out).toContain("describe('archprint architecture boundaries'");
    expect(out).toContain('it("no-utils-to-components", async () => {');
    expect(out).toContain('.matchingPattern("(^|/)utils/")');
    expect(out).toContain('.dependOnFiles()');
    expect(out).toContain('.matchingPattern("(^|/)components/")');
    expect(out).toContain('const violations = await filesOfProject()');
    expect(out).toContain('expect(violations).toEqual([]);');
    expect(out).toContain(`// ${rule.comment}`);
  });

  it('JSON-escapes regex patterns so backslashes survive into the test source', () => {
    const out = renderTsArchTests([
      { name: 'no-x', comment: 'c', from: { path: '\\.(ts|tsx)$' }, to: { path: '(^|/)db/' } },
    ]);
    expect(out).toContain('.matchingPattern("\\\\.(ts|tsx)$")');
  });

  it('emits one it() block per rule', () => {
    const out = renderTsArchTests([rule, { ...rule, name: 'no-a-to-b' }]);
    expect(out.match(/it\(/g)).toHaveLength(2);
  });
});
