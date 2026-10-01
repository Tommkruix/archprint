import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { DEPCRUISE_FILE, ESLINT_FILE } from './generate.js';

export const MANAGED_START =
  '// archprint:start (managed by archprint; run `archprint eject` to remove)';
export const MANAGED_END = '// archprint:end';
const SPREAD_MARK = '// archprint:managed';
const INLINE_SPREAD = '...archprintRules /* archprint:managed */, ';
const ESLINT_CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];

function arrayInsertionOffset(node: Node, allowCallArg: boolean): number | null {
  if (Node.isArrayLiteralExpression(node)) return node.getStart() + 1;
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression().getText().split('.').pop();
    if (callee !== 'config' && callee !== 'defineConfig') return null;
    const arrayArg = node
      .getArguments()
      .find((argument) => Node.isArrayLiteralExpression(argument));
    if (arrayArg) return arrayArg.getStart() + 1;
    if (!allowCallArg) return null;
    const openParen = node.getFirstChildByKind(SyntaxKind.OpenParenToken);
    return openParen ? openParen.getEnd() : null;
  }
  if (Node.isIdentifier(node)) {
    const initializer = node
      .getSourceFile()
      .getVariableDeclaration(node.getText())
      ?.getInitializer();
    return initializer ? arrayInsertionOffset(initializer, false) : null;
  }
  return null;
}

function findInsertionPoint(content: string): number | null {
  const sourceFile = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  }).createSourceFile('eslint.config.mjs', content);
  const exportAssignment = sourceFile.getFirstDescendantByKind(SyntaxKind.ExportAssignment);
  if (exportAssignment && !exportAssignment.isExportEquals()) {
    return arrayInsertionOffset(exportAssignment.getExpression(), true);
  }
  const moduleExports = sourceFile
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .find((expression) => expression.getLeft().getText() === 'module.exports');
  return moduleExports ? arrayInsertionOffset(moduleExports.getRight(), true) : null;
}

export function findEslintConfig(dir: string): string | null {
  for (const name of ESLINT_CONFIG_NAMES) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function importReference(configDir: string, targetPath: string): string {
  const relative = path.relative(configDir, targetPath).split(path.sep).join('/');
  return relative.startsWith('./') || relative.startsWith('../') || relative.startsWith('/')
    ? relative
    : `./${relative}`;
}

export interface WireResult {
  changed: boolean;
  reason?: 'already-wired' | 'no-array-export' | 'unparseable';
  content?: string;
}

export function wireEslintContent(content: string, reference: string): WireResult {
  if (content.includes(MANAGED_START)) return { changed: false, reason: 'already-wired' };
  const insertAt = findInsertionPoint(content);
  if (insertAt === null) return { changed: false, reason: 'no-array-export' };
  const remainder = content.slice(insertAt);
  const spread = remainder.startsWith('\n')
    ? `\n  ...archprintRules, ${SPREAD_MARK}`
    : INLINE_SPREAD;
  const withSpread = `${content.slice(0, insertAt)}${spread}${remainder}`;
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
  return kept.join('\n').replace(INLINE_SPREAD, '');
}

export function rewriteEslintReference(content: string, newRef: string): string {
  return content.replace(/(import archprintRules from )(['"`])[^'"`]*\2/, `$1$2${newRef}$2`);
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

const DC_CONFIG_NAMES = [
  '.dependency-cruiser.json',
  '.dependency-cruiser.js',
  '.dependency-cruiser.cjs',
  '.dependency-cruiser.mjs',
];

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
  const current = extendsList(config.extends);
  const next = [...current.filter((entry) => !entry.includes('archprint')), reference];
  if (current.length === next.length && current.every((entry, i) => entry === next[i]))
    return { changed: false, reason: 'already-wired' };
  config.extends = next.length === 1 ? next[0] : next;
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
    hasOutputs: (outDir) => existsSync(path.join(outDir, ESLINT_FILE)),
    findConfig: findEslintConfig,
    canEdit: () => true,
    aggregatePath: (outDir) => path.join(outDir, ESLINT_FILE),
    reference: importReference,
    apply: wireEslintContent,
    remove: unwireEslintContent,
    isWired: (content) => content.includes(MANAGED_START),
    snippet,
  },
  {
    name: 'dependency-cruiser',
    hasOutputs: (outDir) => existsSync(path.join(outDir, DEPCRUISE_FILE)),
    findConfig: (cwd) => findConfig(cwd, DC_CONFIG_NAMES),
    canEdit: (configPath) => configPath.endsWith('.json'),
    aggregatePath: (outDir) => path.join(outDir, DEPCRUISE_FILE),
    reference: importReference,
    apply: wireDependencyCruiserJson,
    remove: unwireDependencyCruiserJson,
    isWired: dependencyCruiserJsonWired,
    snippet: dependencyCruiserSnippet,
  },
];
