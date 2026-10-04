import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  consoleIsolationRule,
  forbiddenImportRule,
  importStyleRule,
  publicApiRules,
  testIsolationRule,
} from '../../src/cli/adopted-rules.js';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { scanRepo } from '../../src/cli/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);

describe('evaluateRules', () => {
  it('finds exactly the import-style violations the detector reports', () => {
    const scan = scanRepo(fixture('deep-relative-auto'));
    const findings = evaluateRules(scan.appDir, [importStyleRule(scan)]);
    expect(findings).toEqual(
      scan.deepRelative.violations.map((violation) => ({
        ruleId: 'import-style',
        file: violation.file,
        subject: violation.specifier,
        kind: 'specifier',
      })),
    );
  });

  it('finds test-isolation and console findings by target and by file', () => {
    const tests = scanRepo(fixture('test-isolation-auto'));
    expect(evaluateRules(tests.appDir, [testIsolationRule(tests)])).toEqual(
      tests.testIsolation.violations.map((violation) => ({
        ruleId: 'test-isolation',
        file: violation.file,
        subject: violation.target,
        kind: 'target',
      })),
    );
    const logs = scanRepo(fixture('console-isolation-auto'));
    expect(evaluateRules(logs.appDir, [consoleIsolationRule(logs)])).toEqual(
      logs.consoleIsolation.violations.map((violation) => ({
        ruleId: 'console-isolation',
        file: violation.file,
        subject: '',
        kind: 'file',
      })),
    );
  });

  it('evaluates each public-API rule against its own directory only', () => {
    const scan = scanRepo(fixture('public-api-auto'));
    const rules = publicApiRules(scan);
    expect(rules.length).toBeGreaterThan(0);
    const findings = evaluateRules(scan.appDir, rules);
    const expected = scan.publicApi.groups
      .filter((group) => group.gate.status === 'AUTO')
      .flatMap((group) =>
        group.violations.map((violation) => ({
          ruleId: rules.find((rule) => rule.family === 'public-api' && rule.dir === group.dir)!.id,
          file: violation.file,
          subject: violation.target,
          kind: 'target',
        })),
      );
    expect(findings).toEqual(expected);
  });

  it('returns nothing for a public-API rule whose directory no longer has a barrel', () => {
    const scan = scanRepo(fixture('public-api-auto'));
    const [rule] = publicApiRules(scan);
    const gone = { ...rule!, family: 'public-api' as const, dir: 'no/such/dir' };
    expect(evaluateRules(scan.appDir, [gone])).toEqual([]);
  });

  it('sees an import hidden behind a barrel only in deep mode, as the rule was adopted', () => {
    const app = mkdtempSync(path.join(tmpdir(), 'archprint-evaluate-'));
    try {
      cpSync(fixture('cli-auto'), app, { recursive: true });
      mkdirSync(path.join(app, 'ui'), { recursive: true });
      writeFileSync(path.join(app, 'ui', 'Button.ts'), 'export const Button = () => null;\n');
      mkdirSync(path.join(app, 'lib', 'kit'), { recursive: true });
      writeFileSync(
        path.join(app, 'lib', 'kit', 'index.ts'),
        "export { Button } from '../../ui/Button';\n",
      );
      mkdirSync(path.join(app, 'app', 'api', 'page'), { recursive: true });
      writeFileSync(
        path.join(app, 'app', 'api', 'page', 'route.ts'),
        "import { Button } from '@/lib/kit';\nexport const GET = () => Button;\n",
      );
      const pattern = scanRepo(app).patterns.find((candidate) => candidate.config.id === 'AP-001')!;
      const uiRule = (mode: 'deep' | 'fast') => ({
        ...forbiddenImportRule(pattern, mode),
        id: 'AP-002',
        forbidden: [{ source: '(^|/)ui/', flags: '' }],
      });
      expect(evaluateRules(app, [uiRule('deep')])).toEqual([
        {
          ruleId: 'AP-002',
          file: 'app/api/page/route.ts',
          subject: '@/lib/kit',
          kind: 'specifier',
        },
      ]);
      expect(evaluateRules(app, [uiRule('fast')])).toEqual([]);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it('runs forbidden-import rules in the resolution mode they were adopted in', () => {
    const app = mkdtempSync(path.join(tmpdir(), 'archprint-evaluate-'));
    try {
      cpSync(fixture('cli-auto'), app, { recursive: true });
      const pattern = scanRepo(app).patterns.find((candidate) => candidate.config.id === 'AP-001')!;
      mkdirSync(path.join(app, 'app', 'api', 'orders'), { recursive: true });
      writeFileSync(
        path.join(app, 'app', 'api', 'orders', 'route.ts'),
        "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n",
      );
      for (const mode of ['deep', 'fast'] as const) {
        expect(evaluateRules(app, [forbiddenImportRule(pattern, mode)])).toEqual([
          {
            ruleId: 'AP-001',
            file: 'app/api/orders/route.ts',
            subject: '@prisma/client',
            kind: 'specifier',
          },
        ]);
      }
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
