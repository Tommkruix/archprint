import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dependencyInternalsRule,
  entryPurityRule,
  phantomDependencyRule,
  serverClientRule,
} from '../../src/cli/adopted-rules.js';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { emitLayout } from '../../src/cli/generate.js';
import { scanRepo, type ScanResult } from '../../src/cli/scan.js';
import { dependencyApp } from './dependency-app.js';
import { eslintOnly, lintConfig, ruleHits } from './eslint-harness.js';
import { writeTree } from './layer-app.js';

const PHANTOM = 'archprint/no-phantom-dependencies';
const SERVER_CLIENT = 'archprint/no-server-only-in-client';
const INTERNALS = 'archprint/no-dependency-internals';
const ENTRY = 'archprint/no-import-framework-entry';
const RULES = [PHANTOM, SERVER_CLIENT, INTERNALS, ENTRY];
const ESLINT_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('eslint/package.json')),
  'bin',
  'eslint.js',
);

describe('generated ESLint dependency rules (end to end)', () => {
  let root: string;
  let scan: ScanResult;
  let eslint: ESLint;
  const at = (...segments: string[]): string => path.join(root, ...segments);

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-dependency-rules-')));
    writeTree(root, dependencyApp());
    scan = scanRepo(root);
    expect(scan.phantomDependencies.gate.status).toBe('AUTO');
    expect(scan.phantomDependencies.violations.map((v) => v.file)).toEqual([
      'src/lib/legacy-phantom.ts',
    ]);
    expect(scan.serverClient.gate.status).toBe('AUTO');
    expect(scan.serverClient.violations).toEqual([
      { file: 'src/components/legacy-client.tsx', target: 'src/lib/db.ts' },
    ]);
    expect(scan.dependencyInternals.gate.status).toBe('AUTO');
    expect(scan.dependencyInternals.violations).toEqual([
      { file: 'src/lib/legacy-internal.ts', specifier: 'next/src/server' },
    ]);
    expect(scan.entryPurity.gate.status).toBe('AUTO');
    expect(scan.entryPurity.imports).toEqual([
      { file: 'src/app/r0/page.tsx', importer: 'src/lib/legacy-entry.ts' },
    ]);
    emitLayout(scan, at('.archprint'), {
      version: '9.9.9',
      enforcers: eslintOnly,
      structural: true,
    });
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: lintConfig(root, './.archprint/eslint.mjs'),
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes every file the scan read on the day it is generated', async () => {
    const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
    expect(results.length).toBeGreaterThan(60);
    const hits = results.flatMap((result) =>
      result.messages.filter((m) => RULES.includes(m.ruleId ?? '')),
    );
    expect(hits).toEqual([]);
  });

  it('reports an undeclared package, including a scoped one and a dynamic import', async () => {
    const file = at('src', 'lib', 'new.ts');
    expect(
      await ruleHits(eslint, PHANTOM, "import _ from 'lodash';\nexport const x = _;\n", file),
    ).toBe(1);
    expect(
      await ruleHits(
        eslint,
        PHANTOM,
        "import { z } from '@acme/zod';\nexport const x = z;\n",
        file,
      ),
    ).toBe(1);
    expect(
      await ruleHits(eslint, PHANTOM, "export const load = () => import('zod');\n", file),
    ).toBe(1);
  });

  it('allows declared packages, builtins, aliases, subpath imports and type-only imports', async () => {
    const file = at('src', 'lib', 'new.ts');
    const allowed = [
      "import { useState } from 'react';\nexport const x = useState;\n",
      "import { readFile } from 'node:fs/promises';\nimport path from 'path';\nexport const x = [readFile, path];\n",
      "import { db } from '@/lib/db';\nexport const x = db;\n",
      "import { env } from '#env';\nexport const x = env;\n",
      "import type { ZodType } from 'zod';\nexport type X = ZodType;\n",
    ];
    for (const source of allowed) expect(await ruleHits(eslint, PHANTOM, source, file)).toBe(0);
    const leak = "import _ from 'lodash';\nexport const x = _;\n";
    expect(await ruleHits(eslint, PHANTOM, leak, at('src', 'lib', 'legacy-phantom.ts'))).toBe(0);
    expect(await ruleHits(eslint, PHANTOM, leak, at('src', 'lib', 'new.test.ts'))).toBe(0);
  });

  it('reads package.json when ESLint starts, so a newly declared package passes without regenerating', () => {
    writeFileSync(
      at('src', 'lib', 'uses-zod.ts'),
      "import { z } from 'zod';\nexport const x = z;\n",
    );
    const lint = (): { exitCode: number; rules: string[] } => {
      try {
        execFileSync(process.execPath, [ESLINT_BIN, '--format', 'json', 'src/lib/uses-zod.ts'], {
          cwd: root,
          stdio: 'pipe',
        });
        return { exitCode: 0, rules: [] };
      } catch (error) {
        const output = JSON.parse(String((error as { stdout: Buffer }).stdout)) as {
          messages: { ruleId: string }[];
        }[];
        return { exitCode: 1, rules: output.flatMap((r) => r.messages.map((m) => m.ruleId)) };
      }
    };
    const packageJson = at('package.json');
    const original = readFileSync(packageJson, 'utf8');
    try {
      expect(lint()).toEqual({ exitCode: 1, rules: [PHANTOM] });
      const declared = JSON.parse(original) as { dependencies: Record<string, string> };
      declared.dependencies.zod = '4.0.0';
      writeFileSync(packageJson, JSON.stringify(declared));
      expect(lint()).toEqual({ exitCode: 0, rules: [] });
    } finally {
      writeFileSync(packageJson, original);
      rmSync(at('src', 'lib', 'uses-zod.ts'), { force: true });
    }
  });

  it('reports a client module importing a server-only module, by alias, relative path or .js extension', async () => {
    const file = at('src', 'components', 'new.tsx');
    for (const specifier of ['@/lib/db', '../lib/db', '@/lib/db.js']) {
      const source = `'use client';\nimport { db } from '${specifier}';\nexport const X = db;\n`;
      expect(await ruleHits(eslint, SERVER_CLIENT, source, file)).toBe(1);
    }
    expect(
      await ruleHits(eslint, SERVER_CLIENT, "'use client';\nimport 'server-only';\n", file),
    ).toBe(1);
    const afterComment =
      "// a client widget\n'use client';\nimport { db } from '@/lib/db';\nexport const X = db;\n";
    expect(await ruleHits(eslint, SERVER_CLIENT, afterComment, file)).toBe(1);
  });

  it('leaves server modules, type-only imports, plain modules and the known exception alone', async () => {
    const file = at('src', 'components', 'new.tsx');
    const fine = [
      "import { db } from '@/lib/db';\nexport const X = db;\n",
      "'use client';\nimport type { db } from '@/lib/db';\nexport type X = typeof db;\n",
      "'use client';\nimport { note } from '@/lib/note';\nexport const X = note;\n",
    ];
    for (const source of fine) expect(await ruleHits(eslint, SERVER_CLIENT, source, file)).toBe(0);
    const legacy = "'use client';\nimport { db } from '@/lib/db';\nexport const Legacy = db;\n";
    expect(
      await ruleHits(eslint, SERVER_CLIENT, legacy, at('src', 'components', 'legacy-client.tsx')),
    ).toBe(0);
  });

  it('reports reaching into a package, but not its public entry or subpaths', async () => {
    const file = at('src', 'lib', 'new.ts');
    for (const specifier of ['next/src/server', 'next/internal/router', '@acme/ui/internals/x']) {
      const source = `import { x } from '${specifier}';\nexport const y = x;\n`;
      expect(await ruleHits(eslint, INTERNALS, source, file)).toBe(1);
    }
    for (const specifier of [
      'next',
      'next/navigation',
      'react/jsx-runtime',
      '@/lib/db',
      '#src/x',
    ]) {
      const source = `import { x } from '${specifier}';\nexport const y = x;\n`;
      expect(await ruleHits(eslint, INTERNALS, source, file)).toBe(0);
    }
    const legacy = "import { x } from 'next/src/server';\nexport const i = x;\n";
    expect(await ruleHits(eslint, INTERNALS, legacy, at('src', 'lib', 'legacy-internal.ts'))).toBe(
      0,
    );
  });

  it('reports importing a page from other code, but not existing imports or pages importing pages', async () => {
    const page = "import Page from '@/app/r1/page';\nexport const p = Page;\n";
    expect(await ruleHits(eslint, ENTRY, page, at('src', 'lib', 'new.ts'))).toBe(1);
    const relative = "import Page from '../app/r2/page';\nexport const p = Page;\n";
    expect(await ruleHits(eslint, ENTRY, relative, at('src', 'lib', 'new.ts'))).toBe(1);
    const known = "import Page from '@/app/r0/page';\nexport const p = Page;\n";
    expect(await ruleHits(eslint, ENTRY, known, at('src', 'lib', 'legacy-entry.ts'))).toBe(0);
    expect(await ruleHits(eslint, ENTRY, known, at('src', 'lib', 'new.ts'))).toBe(1);
    expect(await ruleHits(eslint, ENTRY, page, at('src', 'app', 'r3', 'page.tsx'))).toBe(0);
    const typeOnly = "import type Page from '@/app/r1/page';\nexport type P = typeof Page;\n";
    expect(await ruleHits(eslint, ENTRY, typeOnly, at('src', 'lib', 'new.ts'))).toBe(0);
  });

  it('reports exactly the files archprint check reports, on the same imports', async () => {
    const probes: Record<string, string> = {
      'src/probe/undeclared.ts':
        "import _ from 'lodash';\nimport dayjs from 'dayjs';\nexport const x = [_, dayjs];\n",
      'src/probe/dynamic.ts': "export const load = () => import('zod');\n",
      'src/probe/declared.ts': "import { useState } from 'react';\nexport const x = useState;\n",
      'src/probe/type-only.ts': "import type { ZodType } from 'zod';\nexport type X = ZodType;\n",
      'src/probe/subpath.ts': "import { env } from '#env';\nexport const x = env;\n",
      'src/probe/client-db.tsx':
        "'use client';\nimport { db } from '@/lib/db';\nexport const X = db;\n",
      'src/probe/client-js.tsx':
        "'use client';\nimport { db } from '../lib/db.js';\nexport const X = db;\n",
      'src/probe/client-only.tsx': "'use client';\nimport 'server-only';\nexport const X = 1;\n",
      'src/probe/client-type.tsx':
        "'use client';\nimport type { db } from '@/lib/db';\nexport type X = typeof db;\n",
      'src/probe/server.ts': "import { db } from '@/lib/db';\nexport const x = db;\n",
      'src/probe/probe.test.ts': "import _ from 'lodash';\nexport const x = _;\n",
      'src/probe/internal.ts': "import { x } from 'next/src/client';\nexport const y = x;\n",
      'src/probe/public.ts':
        "import { useRouter } from 'next/navigation';\nexport const y = useRouter;\n",
      'src/probe/imports-page.ts': "import Page from '@/app/r5/page';\nexport const p = Page;\n",
      'src/probe/imports-known-page.ts':
        "import Page from '@/app/r0/page';\nexport const p = Page;\n",
    };
    writeTree(root, probes);
    try {
      const rules = [
        phantomDependencyRule(scan),
        serverClientRule(scan),
        dependencyInternalsRule(scan),
        entryPurityRule(scan),
      ];
      const known = [
        'src/lib/legacy-phantom.ts',
        'src/components/legacy-client.tsx',
        'src/lib/legacy-internal.ts',
      ];
      const knownEntryImports = scan.entryPurity.imports.map(
        (entry) => `${entry.importer} -> ${entry.file}`,
      );
      const isKnown = (finding: { ruleId: string; file: string; subject: string }): boolean =>
        finding.ruleId === 'no-import-framework-entry'
          ? knownEntryImports.includes(`${finding.file} -> ${finding.subject}`)
          : known.includes(finding.file);
      const countsByFile = (files: string[]): Record<string, number> =>
        Object.fromEntries(
          [...new Set(files)].sort().map((file) => [file, files.filter((f) => f === file).length]),
        );
      const checked = (ruleId: string): Record<string, number> =>
        countsByFile(
          evaluateRules(root, rules)
            .filter((finding) => finding.ruleId === ruleId && !isKnown(finding))
            .map((finding) => finding.file),
        );
      const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
      const linted = (ruleId: string): Record<string, number> =>
        countsByFile(
          results.flatMap((result) =>
            result.messages
              .filter((m) => m.ruleId === `archprint/${ruleId}`)
              .map(() => path.relative(root, result.filePath).split(path.sep).join('/')),
          ),
        );
      for (const ruleId of RULES.map((rule) => rule.replace('archprint/', ''))) {
        expect(linted(ruleId)).toEqual(checked(ruleId));
      }
      expect(linted('no-phantom-dependencies')).toEqual({
        'src/probe/dynamic.ts': 1,
        'src/probe/undeclared.ts': 2,
      });
      expect(linted('no-dependency-internals')).toEqual({ 'src/probe/internal.ts': 1 });
      expect(linted('no-import-framework-entry')).toEqual({
        'src/probe/imports-known-page.ts': 1,
        'src/probe/imports-page.ts': 1,
      });
      expect(linted('no-server-only-in-client')).toEqual({
        'src/probe/client-db.tsx': 1,
        'src/probe/client-js.tsx': 1,
        'src/probe/client-only.tsx': 1,
      });
    } finally {
      rmSync(at('src', 'probe'), { recursive: true, force: true });
    }
  });
});
