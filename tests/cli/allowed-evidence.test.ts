import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { excludeAllowed } from '../../src/cli/allowed-evidence.js';
import { scanRepo, type ScanResult } from '../../src/cli/scan.js';
import { publicApiRuleName } from '../../src/generator/public-api-emitters.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('excludeAllowed', () => {
  let app: string;
  let scan: ScanResult;
  beforeAll(() => {
    app = mkdtempSync(path.join(tmpdir(), 'archprint-evidence-'));
    cpSync(path.join(here, '..', 'fixtures', 'cli-auto'), app, { recursive: true });
    mkdirSync(path.join(app, 'app', 'api', 'health'), { recursive: true });
    writeFileSync(
      path.join(app, 'app', 'api', 'health', 'route.ts'),
      "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n",
    );
    scan = scanRepo(app);
  });
  afterAll(() => rmSync(app, { recursive: true, force: true }));

  const ap001 = (result: ScanResult) =>
    result.patterns.find((p) => p.config.id === 'AP-001')!.result;

  it('a single new break pushes a thin rule below the gate', () => {
    expect(ap001(scan).gate.status).not.toBe('AUTO');
  });

  it('leaves an allowed exception out of the evidence, so the rule clears the gate again', () => {
    const adjusted = ap001(
      excludeAllowed(scan, new Map([['AP-001', ['app/api/health/route.ts']]])),
    );
    expect(adjusted.gate.status).toBe('AUTO');
    expect(adjusted.violations).toEqual([]);
    expect(adjusted.stats.roleFileCount).toBe(ap001(scan).stats.roleFileCount - 1);
  });

  it('keeps the infrastructure caution for an infrastructure break that is not allowed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-infra-'));
    try {
      cpSync(path.join(here, '..', 'fixtures', 'cli-auto'), dir, { recursive: true });
      for (const route of ['health', 'cron']) {
        mkdirSync(path.join(dir, 'app', 'api', route), { recursive: true });
        writeFileSync(
          path.join(dir, 'app', 'api', route, 'route.ts'),
          "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n",
        );
      }
      const scan = scanRepo(dir);
      expect(ap001(scan).infraExceptions).toHaveLength(2);
      const adjusted = ap001(
        excludeAllowed(scan, new Map([['AP-001', ['app/api/health/route.ts']]])),
      );
      expect(adjusted.infraExceptions).toEqual(['app/api/cron/route.ts']);
      expect(adjusted.infraCaution).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('changes nothing for rules without an allowed exception, or files the rule does not report', () => {
    expect(excludeAllowed(scan, new Map())).toBe(scan);
    const untouched = excludeAllowed(
      scan,
      new Map([
        ['AP-001', ['lib/util.ts']],
        ['AP-002', ['x.ts']],
      ]),
    );
    expect(ap001(untouched)).toBe(ap001(scan));
    expect(untouched.consoleIsolation).toBe(scan.consoleIsolation);
  });
});

describe('excludeAllowed for each adoptable family', () => {
  const copies: string[] = [];
  afterAll(() => copies.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const withBreak = (fixture: string, file: string, content: string): ScanResult => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-family-'));
    copies.push(dir);
    cpSync(path.join(here, '..', 'fixtures', fixture), dir, { recursive: true });
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
    return scanRepo(dir);
  };

  type Family = {
    name: string;
    fixture: string;
    file: string;
    content: string;
    rule: (scan: ScanResult) => string;
    view: (scan: ScanResult) => { files: string[]; population: number };
  };
  const families: Family[] = [
    {
      name: 'console isolation',
      fixture: 'console-isolation-auto',
      file: 'src/logger.ts',
      content: 'export const log = (message: string): void => {\n  console.log(message);\n};\n',
      rule: () => 'console-isolation',
      view: (s) => ({
        files: s.consoleIsolation.violations.map((v) => v.file),
        population: s.consoleIsolation.libraryFileCount,
      }),
    },
    {
      name: 'import style',
      fixture: 'deep-relative-auto',
      file: 'src/deep/a/b/c.ts',
      content:
        "import { helper } from '../../../util/helper';\nexport const c = (): number => helper();\n",
      rule: () => 'import-style',
      view: (s) => ({
        files: s.deepRelative.violations.map((v) => v.file),
        population: s.deepRelative.relativeImporterCount,
      }),
    },
    {
      name: 'test isolation',
      fixture: 'test-isolation-auto',
      file: 'src/leak.ts',
      content: "import { v0 } from './m0.test';\nexport const leak = v0;\n",
      rule: () => 'test-isolation',
      view: (s) => ({
        files: s.testIsolation.violations.map((v) => v.file),
        population: s.testIsolation.productionFileCount,
      }),
    },
    {
      name: 'public API',
      fixture: 'public-api-auto',
      file: 'consumers/leak.ts',
      content:
        "import { thing } from '@/lib/thing/impl';\nexport const leak = (): number => thing();\n",
      rule: (s) => publicApiRuleName(s.publicApi.groups[0]!.dir),
      view: (s) => ({
        files: s.publicApi.groups[0]!.violations.map((v) => v.file),
        population: s.publicApi.groups[0]!.consumerCount,
      }),
    },
  ];

  for (const family of families) {
    it(`leaves an allowed ${family.name} break out of the rule's evidence`, () => {
      const scan = withBreak(family.fixture, family.file, family.content);
      const before = family.view(scan);
      expect(before.files).toContain(family.file);
      const after = family.view(
        excludeAllowed(scan, new Map([[family.rule(scan), [family.file]]])),
      );
      expect(after.files).not.toContain(family.file);
      expect(after.population).toBe(before.population - 1);
    });
  }
});
