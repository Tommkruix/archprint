import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { excludeAllowed } from '../../src/cli/allowed-evidence.js';
import { scanRepo, type ScanResult } from '../../src/cli/scan.js';
import { appIsolationRuleName } from '../../src/generator/app-isolation-emitters.js';
import { featureSliceRuleName } from '../../src/generator/feature-slice-emitters.js';
import { publicApiRuleName } from '../../src/generator/public-api-emitters.js';
import { nextApp, writeTree } from '../integration/layer-app.js';

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
    populationDrop?: number;
  };
  const repositoryToService = (s: ScanResult) =>
    s.roleLayering.boundaries.find((b) => b.from === 'REPOSITORY' && b.to === 'SERVICE')!;
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
    {
      name: 'env access',
      fixture: 'env-access-auto',
      file: 'src/app/leak.ts',
      content: 'export const leak = (): string | undefined => process.env.SECRET;\n',
      rule: () => 'env-access',
      view: (s) => ({
        files: s.envAccess.violations.map((v) => v.file),
        population: s.envAccess.subjectFileCount,
      }),
    },
    {
      name: 'workspace package',
      fixture: 'workspace-package-auto',
      file: 'packages/pkg-a/src/leak.ts',
      content:
        "import { b } from '@scope/pkg-b/src/index';\nexport const leak = (): number => b();\n",
      rule: () => 'workspace-package',
      view: (s) => ({
        files: s.workspacePackageApi.violations.map((v) => v.file),
        population: s.workspacePackageApi.consumerCount,
      }),
    },
    {
      name: 'UI/data',
      fixture: 'ui-data-auto',
      file: 'src/components/Leak.tsx',
      content: "import { q } from '@/src/db/queries';\nexport const Leak = (): number => q();\n",
      rule: () => 'no-ui-to-data',
      view: (s) => ({
        files: s.uiDataIsolation.violations.map((v) => v.file),
        population: s.uiDataIsolation.componentCount,
      }),
    },
    {
      name: 'stories isolation',
      fixture: 'stories-isolation-auto',
      file: 'src/use.ts',
      content:
        "import { Story2 } from './c2.stories';\nexport const use = (): number => Story2();\n",
      rule: () => 'no-import-stories',
      view: (s) => ({
        files: s.storiesIsolation.violations.map((v) => v.importer),
        population: s.storiesIsolation.storyCount,
      }),
      populationDrop: 0,
    },
    {
      name: 'role layering',
      fixture: 'role-layering-auto',
      file: 'src/m99.repository.ts',
      content:
        "import { svc25 } from '@/src/m25.service';\nexport const repo99 = (): unknown => svc25;\n",
      rule: () => 'no-repository-to-service',
      view: (s) => ({
        files: repositoryToService(s).violations.map((v) => v.file),
        population: repositoryToService(s).roleFileCount,
      }),
    },
    {
      name: 'feature slice',
      fixture: 'feature-slice-auto',
      file: 'src/features/alpha/leak.ts',
      content: "import { beta2 } from '../beta/f2';\nexport const leak = (): number => beta2();\n",
      rule: (s) => featureSliceRuleName(s.featureSlices.groups[0]!.container),
      view: (s) => ({
        files: s.featureSlices.groups[0]!.violations.map((v) => v.file),
        population: s.featureSlices.groups[0]!.sliceFileCount,
      }),
    },
    {
      name: 'app isolation',
      fixture: 'app-isolation-auto',
      file: 'apps/alpha/leak.ts',
      content: "import { beta2 } from '../beta/f2';\nexport const leak = (): number => beta2();\n",
      rule: (s) => appIsolationRuleName(s.appIsolation.groups[0]!.container),
      view: (s) => ({
        files: s.appIsolation.groups[0]!.violations.map((v) => v.file),
        population: s.appIsolation.groups[0]!.appFileCount,
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
      expect(after.population).toBe(before.population - (family.populationDrop ?? 1));
    });
  }
});

describe('excludeAllowed on layer boundaries', () => {
  let app: string;
  let scan: ScanResult;
  beforeAll(() => {
    app = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-layer-evidence-')));
    writeTree(app, nextApp());
    scan = scanRepo(app);
  });
  afterAll(() => rmSync(app, { recursive: true, force: true }));

  const libApp = (result: ScanResult) =>
    result.layerBoundaries.find((boundary) => boundary.from === 'lib' && boundary.to === 'app')!;

  it('leaves an allowed layer exception out of the evidence and re-gates the boundary', () => {
    const before = libApp(scan);
    const after = libApp(excludeAllowed(scan, new Map([['no-lib-to-app', ['src/lib/legacy.ts']]])));
    expect(before.violations.map((violation) => violation.file)).toEqual(['src/lib/legacy.ts']);
    expect(after.violations).toEqual([]);
    expect(after.stats.violatingFileCount).toBe(0);
    expect(after.stats.roleFileCount).toBe(before.stats.roleFileCount - 1);
    expect(after.stats.roleConfidence).toBeGreaterThan(before.stats.roleConfidence);
  });

  it('leaves a boundary alone when another rule is allowed', () => {
    const other = excludeAllowed(scan, new Map([['no-app-to-lib', ['src/lib/legacy.ts']]]));
    expect(libApp(other)).toBe(libApp(scan));
  });
});
