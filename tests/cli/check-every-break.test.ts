import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdoptedRule } from '../../src/cli/adopted-rules.js';
import { diffFindings } from '../../src/cli/check-diff.js';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { detectLayerBoundaries } from '../../src/detector/layer-detector.js';
import { detectForbiddenImports } from '../../src/detector/pattern-detector.js';
import { detectRoleLayering } from '../../src/detector/role-layering-detector.js';
import { detectStoriesIsolation } from '../../src/detector/stories-isolation-detector.js';
import { writeTree } from '../integration/layer-app.js';

const evidence = { conforming: 1, total: 1, floor: 0 };
const base = { statement: 'A rule.', mode: 'fast' as const, evidence };

const SHARED = {
  'tsconfig.json': '{}',
  'package.json': '{"name":"app"}',
  'src/components/modal.tsx': 'export const Modal = () => null;\n',
  'src/components/sheet.tsx': 'export const Sheet = () => null;\n',
  'src/users/users.service.ts': 'export const list = () => [];\n',
  'src/users/audit.service.ts': 'export const log = () => [];\n',
  'src/lib/db.ts': 'export const db = {};\n',
  'src/lib/db-admin.ts': 'export const admin = {};\n',
  'src/ui/button.stories.tsx': 'export default {};\n',
};

interface Case {
  rule: AdoptedRule;
  before: Record<string, string>;
  after: Record<string, string>;
  /** What check reports as new: the added import, or every access when the file has more of the same. */
  introduced: string[];
}

const CASES: Record<string, Case> = {
  layer: {
    rule: {
      ...base,
      id: 'no-hooks-to-components',
      family: 'layer',
      from: 'hooks',
      to: 'components',
    },
    before: {
      'src/hooks/use-step-up.tsx':
        "import { Modal } from '../components/modal';\nexport const m = Modal;\n",
    },
    after: {
      'src/hooks/use-step-up.tsx':
        "import { Modal } from '../components/modal';\nimport { Sheet } from '../components/sheet';\nexport const m = [Modal, Sheet];\n",
    },
    introduced: ['src/hooks/use-step-up.tsx ../components/sheet'],
  },
  'role-layering': {
    rule: {
      ...base,
      id: 'no-repository-to-service',
      family: 'role-layering',
      from: 'REPOSITORY',
      to: 'SERVICE',
    },
    before: {
      'src/users/users.repository.ts':
        "import { list } from './users.service';\nexport const l = list;\n",
    },
    after: {
      'src/users/users.repository.ts':
        "import { list } from './users.service';\nimport { log } from './audit.service';\nexport const l = [list, log];\n",
    },
    introduced: ['src/users/users.repository.ts src/users/audit.service.ts'],
  },
  'forbidden-imports': {
    rule: {
      ...base,
      id: 'AP-001',
      family: 'forbidden-imports',
      roles: ['ROUTE_HANDLER'],
      forbidden: [{ source: 'lib/db', flags: '' }],
    },
    before: {
      'app/api/users/route.ts':
        "import { db } from '../../../src/lib/db';\nexport const GET = () => db;\n",
    },
    after: {
      'app/api/users/route.ts':
        "import { db } from '../../../src/lib/db';\nimport { admin } from '../../../src/lib/db-admin';\nexport const GET = () => [db, admin];\n",
    },
    introduced: ['app/api/users/route.ts ../../../src/lib/db-admin'],
  },
  'console-isolation': {
    rule: { ...base, id: 'console-isolation', family: 'console-isolation' },
    before: { 'src/hooks/use-step-up.tsx': 'console.log(1);\nexport const a = 1;\n' },
    after: {
      'src/hooks/use-step-up.tsx': 'console.log(1);\nconsole.warn(2);\nexport const a = 1;\n',
    },
    introduced: ['src/hooks/use-step-up.tsx console', 'src/hooks/use-step-up.tsx console'],
  },
  'env-access': {
    rule: { ...base, id: 'env-access', family: 'env-access' },
    before: { 'src/hooks/use-step-up.tsx': 'export const a = process.env.A;\n' },
    after: {
      'src/hooks/use-step-up.tsx':
        'export const a = process.env.A;\nexport const b = process.env.B;\n',
    },
    introduced: ['src/hooks/use-step-up.tsx process.env', 'src/hooks/use-step-up.tsx process.env'],
  },
  'stories-isolation': {
    rule: { ...base, id: 'no-import-stories', family: 'stories-isolation' },
    before: {
      'src/ui/gallery.ts': "import story from './button.stories';\nexport const s = story;\n",
    },
    after: {
      'src/ui/gallery.ts': "import story from './button.stories';\nexport const s = story;\n",
      'src/ui/preview.ts': "import story from './button.stories';\nexport const p = story;\n",
    },
    introduced: ['src/ui/preview.ts src/ui/button.stories.tsx'],
  },
} as Record<string, Case>;

describe('check counts every break, not every breaking file', () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const app = (files: Record<string, string>): string => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-every-break-')));
    temps.push(dir);
    writeTree(dir, { ...SHARED, ...files });
    return dir;
  };

  it.each(Object.entries(CASES))(
    '%s: a file that already breaks the rule breaks it again',
    (_, { rule, before, after, introduced }) => {
      const baseFindings = evaluateRules(app(before), [rule]);
      const headFindings = evaluateRules(app(after), [rule]);
      expect(baseFindings).toHaveLength(1);
      expect(headFindings).toHaveLength(2);
      expect(
        diffFindings(baseFindings, headFindings, new Map()).introduced.map(
          (finding) => `${finding.file} ${finding.subject}`,
        ),
      ).toEqual(introduced);
    },
  );

  it('gives each console and process.env access its line', () => {
    const dir = app(CASES['env-access']!.after);
    expect(evaluateRules(dir, [CASES['env-access']!.rule]).map((finding) => finding.line)).toEqual([
      1, 2,
    ]);
    const logs = app(CASES['console-isolation']!.after);
    expect(
      evaluateRules(logs, [CASES['console-isolation']!.rule]).map((finding) => finding.line),
    ).toEqual([1, 2]);
  });

  it('keeps the scan evidence at one entry per breaking file, by its first break', () => {
    const layered = app({
      ...CASES.layer!.after,
      'src/components/uses-a.tsx': "import { a } from '../hooks/use-a';\nexport const x = a;\n",
      'src/components/uses-b.tsx': "import { a } from '../hooks/use-a';\nexport const y = a;\n",
      'src/hooks/use-a.ts': 'export const a = 1;\n',
    });
    const boundary = detectLayerBoundaries(layered, { minLayerFiles: 1 }).boundaries.find(
      (candidate) => candidate.from === 'hooks' && candidate.to === 'components',
    );
    expect(boundary?.violations).toEqual([
      { file: 'src/hooks/use-step-up.tsx', specifier: '../components/modal' },
    ]);

    const roles = app({
      ...CASES['role-layering']!.after,
      'src/users/one.service.ts': "import { r } from './base.repository';\nexport const o = r;\n",
      'src/users/two.service.ts': "import { r } from './base.repository';\nexport const t = r;\n",
      'src/users/base.repository.ts': 'export const r = 1;\n',
    });
    const roleBoundary = detectRoleLayering(roles).boundaries.find(
      (candidate) => candidate.from === 'REPOSITORY' && candidate.to === 'SERVICE',
    );
    expect(roleBoundary?.violations).toEqual([
      { file: 'src/users/users.repository.ts', target: 'src/users/users.service.ts' },
    ]);

    const rule = CASES['forbidden-imports']!.rule;
    const [pattern] = detectForbiddenImports(
      app(CASES['forbidden-imports']!.after),
      [
        {
          id: rule.id,
          name: rule.id,
          description: rule.statement,
          roles: ['ROUTE_HANDLER'],
          forbidden: [/lib\/db/],
        },
      ],
      { resolve: false },
    );
    expect(pattern!.violations.map(({ file, specifier }) => ({ file, specifier }))).toEqual([
      { file: 'app/api/users/route.ts', specifier: '../../../src/lib/db' },
    ]);

    expect(detectStoriesIsolation(app(CASES['stories-isolation']!.after)).violations).toEqual([
      { file: 'src/ui/button.stories.tsx', importer: 'src/ui/gallery.ts' },
    ]);
  });
});
