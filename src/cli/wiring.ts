import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export const AGGREGATOR_FILE = 'eslint.archprint.mjs';
export const MANAGED_START =
  '// archprint:start (managed by archprint; run `archprint eject` to remove)';
export const MANAGED_END = '// archprint:end';
const SPREAD_MARK = '// archprint:managed';
const ESLINT_CONFIG_NAMES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'];
const ARRAY_OPEN = /(export\s+default\s+\[|module\.exports\s*=\s*\[)/;

const AGGREGATOR_SOURCE = `${MANAGED_START.replace('run `archprint eject` to remove', 'regenerate with `archprint generate`')}
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default readdirSync(here)
  .filter((name) => name.startsWith('eslint.') && name.endsWith('.archprint.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(here, name), 'utf8')));
${MANAGED_END}
`;

export function hasEslintBlocks(paths: readonly string[]): boolean {
  return paths.some((p) => /eslint\.[^/\\]*\.archprint\.json$/.test(p));
}

export function writeEslintAggregator(outDir: string): string {
  const file = path.join(outDir, AGGREGATOR_FILE);
  writeFileSync(file, AGGREGATOR_SOURCE);
  return file;
}

export function findEslintConfig(dir: string): string | null {
  for (const name of ESLINT_CONFIG_NAMES) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function importReference(configDir: string, aggregatorPath: string): string {
  const relative = path.relative(configDir, aggregatorPath).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export interface WireResult {
  changed: boolean;
  reason?: 'already-wired' | 'no-array-export' | 'unparseable';
  content?: string;
}

export function wireEslintContent(content: string, reference: string): WireResult {
  if (content.includes(MANAGED_START)) return { changed: false, reason: 'already-wired' };
  const match = ARRAY_OPEN.exec(content);
  if (!match) return { changed: false, reason: 'no-array-export' };
  const insertAt = match.index + match[0].length;
  const withSpread = `${content.slice(0, insertAt)}\n  ...archprintRules, ${SPREAD_MARK}${content.slice(insertAt)}`;
  const importBlock = `${MANAGED_START}\nimport archprintRules from '${reference}';\n${MANAGED_END}\n`;
  return { changed: true, content: importBlock + withSpread };
}

export function unwireEslintContent(content: string): string {
  const lines = content.split('\n');
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.includes(MANAGED_START)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.includes(MANAGED_END)) inBlock = false;
      continue;
    }
    if (line.includes(SPREAD_MARK)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

export function snippet(reference: string): string {
  return [
    `${MANAGED_START}`,
    `import archprintRules from '${reference}';`,
    `${MANAGED_END}`,
    '',
    'export default [',
    `  ...archprintRules, ${SPREAD_MARK}`,
    '  // ...your existing config',
    '];',
  ].join('\n');
}

export function eslintConfigHasBlock(configPath: string): boolean {
  try {
    return readFileSync(configPath, 'utf8').includes(MANAGED_START);
  } catch {
    /* v8 ignore next -- unreadable config is treated as not wired */
    return false;
  }
}

export function outDirHasEslintBlocks(outDir: string): boolean {
  if (!existsSync(outDir)) return false;
  return readdirSync(outDir).some(
    (name) => name.startsWith('eslint.') && name.endsWith('.archprint.json'),
  );
}

export const DC_AGGREGATE_FILE = 'dependency-cruiser.all.archprint.json';
const DC_CONFIG_NAMES = [
  '.dependency-cruiser.json',
  '.dependency-cruiser.js',
  '.dependency-cruiser.cjs',
  '.dependency-cruiser.mjs',
];
const DC_BLOCK = /^dependency-cruiser\.[^/\\]*\.archprint\.json$/;

const isDcBlock = (name: string): boolean => DC_BLOCK.test(name) && name !== DC_AGGREGATE_FILE;

export function hasDependencyCruiserBlocks(paths: readonly string[]): boolean {
  return paths.some((p) => isDcBlock(path.basename(p)));
}

export function outDirHasDependencyCruiserBlocks(outDir: string): boolean {
  return existsSync(outDir) && readdirSync(outDir).some(isDcBlock);
}

export function writeDependencyCruiserAggregate(outDir: string): string {
  const forbidden: unknown[] = [];
  for (const name of readdirSync(outDir).filter(isDcBlock).sort()) {
    try {
      const config = JSON.parse(readFileSync(path.join(outDir, name), 'utf8')) as {
        forbidden?: unknown[];
      };
      if (Array.isArray(config.forbidden)) forbidden.push(...config.forbidden);
    } catch {
      /* v8 ignore next -- a malformed block contributes nothing to the aggregate */
    }
  }
  const file = path.join(outDir, DC_AGGREGATE_FILE);
  writeFileSync(file, `${JSON.stringify({ forbidden }, null, 2)}\n`);
  return file;
}

const extendsList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

export function wireDependencyCruiserJson(content: string, reference: string): WireResult {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { changed: false, reason: 'unparseable' };
  }
  const list = extendsList(config.extends);
  if (list.includes(reference)) return { changed: false, reason: 'already-wired' };
  list.push(reference);
  config.extends = list.length === 1 ? list[0] : list;
  return { changed: true, content: `${JSON.stringify(config, null, 2)}\n` };
}

export function unwireDependencyCruiserJson(content: string): string {
  const config = JSON.parse(content) as Record<string, unknown>;
  const list = extendsList(config.extends).filter((entry) => !entry.includes('archprint'));
  if (list.length === 0) delete config.extends;
  else config.extends = list.length === 1 ? list[0] : list;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function dependencyCruiserJsonWired(content: string): boolean {
  try {
    return extendsList((JSON.parse(content) as Record<string, unknown>).extends).some((entry) =>
      entry.includes('archprint'),
    );
  } catch {
    /* v8 ignore next -- an unparseable config is treated as not wired */
    return false;
  }
}

export function dependencyCruiserSnippet(reference: string): string {
  return ['{', `  "extends": "${reference}",`, '  "forbidden": []', '}'].join('\n');
}

export interface WiringTool {
  name: string;
  hasOutputs: (outDir: string) => boolean;
  findConfig: (cwd: string) => string | null;
  canEdit: (configPath: string) => boolean;
  aggregatePath: (outDir: string) => string;
  reference: (configDir: string, aggregatePath: string) => string;
  apply: (content: string, reference: string) => WireResult;
  remove: (content: string) => string;
  isWired: (content: string) => boolean;
  snippet: (reference: string) => string;
}

function findConfig(cwd: string, names: readonly string[]): string | null {
  for (const name of names) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const WIRING_TOOLS: readonly WiringTool[] = [
  {
    name: 'eslint',
    hasOutputs: outDirHasEslintBlocks,
    findConfig: findEslintConfig,
    canEdit: () => true,
    aggregatePath: (outDir) => path.join(outDir, AGGREGATOR_FILE),
    reference: importReference,
    apply: wireEslintContent,
    remove: unwireEslintContent,
    isWired: (content) => content.includes(MANAGED_START),
    snippet,
  },
  {
    name: 'dependency-cruiser',
    hasOutputs: outDirHasDependencyCruiserBlocks,
    findConfig: (cwd) => findConfig(cwd, DC_CONFIG_NAMES),
    canEdit: (configPath) => configPath.endsWith('.json'),
    aggregatePath: (outDir) => path.join(outDir, DC_AGGREGATE_FILE),
    reference: importReference,
    apply: wireDependencyCruiserJson,
    remove: unwireDependencyCruiserJson,
    isWired: dependencyCruiserJsonWired,
    snippet: dependencyCruiserSnippet,
  },
];
