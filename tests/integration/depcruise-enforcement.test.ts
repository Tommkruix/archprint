import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise, type ICruiseResult, type IFlattenedRuleSet } from 'dependency-cruiser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAllow } from '../../src/cli/allow.js';
import { buildProgram } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SLICE_RULE = 'no-cross-slice-src-features';
const crossSlice = (name: string): string =>
  `import { beta2 } from '../beta/f2';\nexport const ${name} = beta2;\n`;

describe.each([
  { layout: 'a single app', app: '.' },
  { layout: 'a monorepo app', app: 'apps/web' },
])('generated dependency-cruiser rules in $layout (real dependency-cruiser)', ({ app }) => {
  let cwd: string;
  let repo: string;
  const appFile = (file: string): string => path.join(repo, app, file);
  const generate = () =>
    buildProgram('9.9.9').parseAsync(
      ['generate', app, '--include-structural', '--emit', 'dependency-cruiser'],
      { from: 'user' },
    );
  const violations = async (): Promise<string[]> => {
    const ruleSet = JSON.parse(
      readFileSync(path.join(repo, '.archprint', 'dependency-cruiser.json'), 'utf8'),
    ) as IFlattenedRuleSet;
    const result = await cruise([path.join(app, 'src')], {
      validate: true,
      ruleSet,
      baseDir: repo,
    });
    return (result.output as ICruiseResult).summary.violations
      .map((violation) => `${violation.rule.name}: ${violation.from}`)
      .sort();
  };

  beforeEach(() => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-depcruise-')));
    mkdirSync(path.join(repo, app), { recursive: true });
    cpSync(path.join(here, '..', 'fixtures', 'feature-slice-auto'), path.join(repo, app), {
      recursive: true,
    });
    for (let index = 0; index < 30; index++) {
      for (const slice of ['alpha', 'beta']) {
        writeFileSync(
          appFile(`src/features/${slice}/pad${index}.ts`),
          `export const p${index} = 1;\n`,
        );
      }
    }
    writeFileSync(appFile('src/features/alpha/known.ts'), crossSlice('known'));
    process.chdir(repo);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it('passes on the code it was adopted on, known exception included', async () => {
    await generate();
    expect(await violations()).toEqual([]);
  });

  it('reports a new cross-slice import, under the app path dependency-cruiser sees', async () => {
    await generate();
    writeFileSync(appFile('src/features/alpha/fresh.ts'), crossSlice('fresh'));
    expect(await violations()).toEqual([
      `${SLICE_RULE}: ${path.posix.join(app, 'src/features/alpha/fresh.ts').replace(/^\.\//, '')}`,
    ]);
  });

  it('exempts a file allowed with a reason once the rules are generated again', async () => {
    await generate();
    writeFileSync(appFile('src/features/alpha/fresh.ts'), crossSlice('fresh'));
    runAllow({
      cwd: repo,
      out: '.archprint',
      rule: SLICE_RULE,
      file: path.join(app, 'src/features/alpha/fresh.ts'),
      reason: 'migrating',
    });
    await generate();
    expect(await violations()).toEqual([]);
  });
});
