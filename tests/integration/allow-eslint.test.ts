import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitLayout } from '../../src/cli/generate.js';
import { scanRepo } from '../../src/cli/scan.js';
import {
  exemptionGlobs,
  literalGlob,
  mergeNoRestrictedImports,
} from '../../src/generator/eslint-scope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const eslintOnly = {
  eslint: true,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
};
const restricting = (regex: string, ignores?: string[]) => ({
  ...(ignores ? { ignores } : {}),
  rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message: `no ${regex}` }] }] },
});

describe('allowed exceptions in ESLint (real ESLint)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-allow-eslint-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const lint = async (config: unknown[], files: Record<string, string>) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
      writeFileSync(path.join(tmp, file), content);
    }
    const configPath = path.join(tmp, 'eslint.config.mjs');
    writeFileSync(configPath, `export default ${JSON.stringify(config)};\n`);
    const eslint = new ESLint({ cwd: tmp, overrideConfigFile: configPath });
    const results = await eslint.lintFiles(Object.keys(files));
    return new Map(
      results.map((result) => [
        path.relative(tmp, result.filePath),
        result.messages
          .map((message) => /no \w+$/.exec(message.message)?.[0] ?? message.message)
          .sort(),
      ]),
    );
  };

  it('exempts a monorepo app file from one shared-rule family, not the same path in a sibling app', async () => {
    const both = "import a from './deep/x';\nimport b from './y.fixture';\nexport { a, b };\n";
    const messages = await lint(
      mergeNoRestrictedImports([
        restricting('deep', exemptionGlobs(literalGlob('src/allowed.ts'), 'apps/web')),
        restricting('fixture'),
      ]),
      {
        'apps/web/src/allowed.ts': both,
        'apps/web/src/other.ts': both,
        'apps/admin/src/allowed.ts': both,
      },
    );
    expect(messages.get('apps/web/src/allowed.ts')).toEqual(['no fixture']);
    expect(messages.get('apps/web/src/other.ts')).toEqual(['no deep', 'no fixture']);
    expect(messages.get('apps/admin/src/allowed.ts')).toEqual(['no deep', 'no fixture']);
  });

  it('exempts a file in a framework route folder exactly, not the files its name would match as a glob', async () => {
    const both = "import a from './deep/x';\nimport b from './y.fixture';\nexport { a, b };\n";
    const allowed = 'app/(shop)/@modal/[[...slug]]/[id]/route.ts';
    const messages = await lint(
      mergeNoRestrictedImports([
        restricting('deep', exemptionGlobs(literalGlob(allowed), 'apps/(web)')),
        restricting('fixture'),
      ]),
      {
        [`apps/(web)/${allowed}`]: both,
        'apps/(web)/app/(shop)/@modal/[[...slug]]/i/route.ts': both,
        'apps/(web)/app/shop/modal/s/d/route.ts': both,
        'apps/w/app/(shop)/@modal/[[...slug]]/[id]/route.ts': both,
      },
    );
    expect(messages.get(`apps/(web)/${allowed}`)).toEqual(['no fixture']);
    expect(messages.get('apps/(web)/app/(shop)/@modal/[[...slug]]/i/route.ts')).toEqual([
      'no deep',
      'no fixture',
    ]);
    expect(messages.get('apps/(web)/app/shop/modal/s/d/route.ts')).toEqual([
      'no deep',
      'no fixture',
    ]);
    expect(messages.get('apps/w/app/(shop)/@modal/[[...slug]]/[id]/route.ts')).toEqual([
      'no deep',
      'no fixture',
    ]);
  });

  it('exempts a file whose folder name holds braces, not the folders brace expansion would name', async () => {
    const both = "import a from './deep/x';\nexport { a };\n";
    const messages = await lint(
      [{ files: ['**/*.ts'] }, restricting('deep', [literalGlob('src/{a,b}/x.ts')])],
      {
        'src/{a,b}/x.ts': both,
        'src/a/x.ts': both,
        'src/b/x.ts': both,
      },
    );
    expect(messages.get('src/{a,b}/x.ts')).toEqual([]);
    expect(messages.get('src/a/x.ts')).toEqual(['no deep']);
    expect(messages.get('src/b/x.ts')).toEqual(['no deep']);
  });

  it('stops an AP rule flagging an allowed file and keeps flagging the others', async () => {
    cpSync(path.join(here, '..', 'fixtures', 'cli-auto'), tmp, { recursive: true });
    const direct =
      "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n";
    const outDir = path.join(tmp, '.archprint');
    mkdirSync(outDir);
    emitLayout(scanRepo(tmp), outDir, {
      version: '9.9.9',
      enforcers: eslintOnly,
      allowed: new Map([['AP-001', ['app/api/legacy/route.ts']]]),
    });
    for (const file of ['app/api/legacy/route.ts', 'app/api/orders/route.ts']) {
      mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
      writeFileSync(path.join(tmp, file), direct);
    }
    writeFileSync(
      path.join(tmp, 'eslint.config.mjs'),
      "import archprint from './.archprint/eslint.mjs';\nexport default [...archprint];\n",
    );
    const eslint = new ESLint({
      cwd: tmp,
      overrideConfigFile: path.join(tmp, 'eslint.config.mjs'),
    });
    const results = await eslint.lintFiles(['app/api/legacy/route.ts', 'app/api/orders/route.ts']);
    const byFile = new Map(results.map((r) => [path.relative(tmp, r.filePath), r.messages.length]));
    expect(byFile.get('app/api/legacy/route.ts')).toBe(0);
    expect(byFile.get('app/api/orders/route.ts')).toBe(1);
  });
});
