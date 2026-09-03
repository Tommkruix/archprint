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
  reason?: 'already-wired' | 'no-array-export';
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
