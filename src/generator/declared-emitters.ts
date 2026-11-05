import * as path from 'node:path';
import {
  type DeclaredDefinition,
  importResolution,
  type ImportResolution,
} from '../detector/declared-rules.js';
import { globPattern, type GlobPattern } from '../scanner/globs.js';

/** A declared rule as generate adopted it: its definition, root, sentence, source and recorded exceptions. */
export type DeclaredRuleInput = DeclaredDefinition & {
  id: string;
  statement: string;
  root: string;
  source: { file: string; line: number };
  exceptions?: string[];
};

/** A declared rule as the generated ESLint file enforces it, with its globs compiled. */
export interface DeclaredRuleSpec {
  name: string;
  message: string;
  /** App-relative files exempt from it: its recorded exceptions and allowed files. */
  ignore: string[];
  template: DeclaredDefinition['template'];
  /** The rules directory's path to the root the globs are written against; also the key into the resolution table. */
  root: string;
  files: GlobPattern[];
  except: GlobPattern[];
  targets: GlobPattern[];
  packages: { name: GlobPattern; imports?: string[] }[];
  usage: string[];
}

export interface DeclaredEslintRules {
  /** How imports resolve under the app, for each root the rules are written against. */
  roots: Record<string, ImportResolution>;
  rules: DeclaredRuleSpec[];
}

const compile = (globs: readonly string[]): GlobPattern[] => globs.map(globPattern);

function specOf(rule: DeclaredRuleInput, allowed: readonly string[]): DeclaredRuleSpec {
  return {
    name: rule.id,
    message: `${rule.statement} (${rule.source.file}:${rule.source.line})`,
    ignore: [...new Set([...(rule.exceptions ?? []), ...allowed])].sort(),
    template: rule.template,
    root: rule.root,
    files: compile(rule.files),
    except: compile(rule.except),
    targets: rule.template === 'forbid-import' ? compile(rule.targets) : [],
    packages:
      rule.template === 'forbid-import'
        ? rule.packages.map((target) => ({
            name: globPattern(target.name),
            ...(target.imports !== undefined && { imports: target.imports }),
          }))
        : [],
    usage: rule.template === 'forbid-usage' ? rule.usage : [],
  };
}

/** The declared rules for the generated ESLint file, with the import resolution each of their roots needs. */
export function declaredEslintRules(
  rules: readonly DeclaredRuleInput[],
  appDir: string,
  rulesDir: string,
  allowedFor: (ruleId: string) => readonly string[],
): DeclaredEslintRules | null {
  if (rules.length === 0) return null;
  const roots: Record<string, ImportResolution> = {};
  for (const root of [...new Set(rules.map((rule) => rule.root))].sort()) {
    roots[root] = importResolution(path.resolve(rulesDir, root), appDir);
  }
  return { roots, rules: rules.map((rule) => specOf(rule, allowedFor(rule.id))) };
}

/**
 * The lint-time half of a declared rule. It reads a file's imports and globals the way the scan does (see
 * valueModuleImports and globalReferences), so `check` and ESLint report the same files and lines.
 */
export const DECLARED_RUNTIME = `const declaredRegex = (pattern) => new RegExp(pattern.source, pattern.flags);

function declaredImportVisitors(check) {
  const nameOf = (node) => (node.type === 'Identifier' ? node.name : node.value);
  return {
    ImportDeclaration(node) {
      if (node.parent.type !== 'Program' || node.importKind === 'type') return;
      const names = [];
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') names.push('default');
        else if (specifier.type === 'ImportNamespaceSpecifier') names.push('*');
        else if (specifier.importKind !== 'type') names.push(nameOf(specifier.imported));
      }
      if (node.specifiers.length === 0 || names.length > 0) check(node, node.source.value, names);
    },
    ExportNamedDeclaration(node) {
      if (node.source == null || node.parent.type !== 'Program' || node.exportKind === 'type') return;
      const names = node.specifiers
        .filter((specifier) => specifier.exportKind !== 'type')
        .map((specifier) => nameOf(specifier.local));
      if (names.length > 0) check(node, node.source.value, names);
    },
    ExportAllDeclaration(node) {
      if (node.parent.type === 'Program' && node.exportKind !== 'type') check(node, node.source.value, ['*']);
    },
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        check(node, node.source.value, null);
      }
    },
  };
}

function memberRead(identifier) {
  const parent = identifier.parent;
  if (parent.type !== 'MemberExpression' || parent.object !== identifier) return null;
  if (!parent.computed && parent.property.type === 'Identifier') return parent.property.name;
  return parent.computed && parent.property.type === 'Literal' && typeof parent.property.value === 'string'
    ? parent.property.value
    : null;
}

function declaredUsageVisitors(context, usages) {
  const wanted = usages.map((usage) => {
    const [name, member] = usage.split('.');
    return { name, member: member ?? null };
  });
  const names = new Set(wanted.map((usage) => usage.name));
  return {
    'Program:exit'() {
      for (const scope of context.sourceCode.scopeManager.scopes) {
        for (const reference of scope.references) {
          const identifier = reference.identifier;
          if (!names.has(identifier.name) || reference.isValueReference === false) continue;
          if (reference.resolved !== null && reference.resolved.defs.length > 0) continue;
          const member = memberRead(identifier);
          for (const usage of wanted) {
            if (usage.name === identifier.name && (usage.member === null || usage.member === member)) {
              context.report({ node: identifier, messageId: 'forbidden' });
            }
          }
        }
      }
    },
  };
}

function makeDeclaredRule(spec) {
  const resolution = DECLARED_ROOTS[spec.root];
  const root = realPathOf(resolve(CONFIG_DIR, spec.root));
  const files = spec.files.map(declaredRegex);
  const except = spec.except.map(declaredRegex);
  const targets = spec.targets.map(declaredRegex);
  const packages = spec.packages.map((target) => ({ name: declaredRegex(target.name), imports: target.imports }));
  const fileFor = (base) => firstPartyCandidates(base).find((candidate) => existsSync(join(root, candidate))) ?? null;
  const takesForbidden = (names, target) =>
    target.imports === undefined ||
    (names !== null && names.some((name) => name === '*' || target.imports.includes(name)));
  return {
    meta: { type: 'problem', schema: [], messages: { forbidden: spec.message } },
    create(context) {
      const file = appRelativePath(context.physicalFilename);
      if (file === null || !isScanned(file) || spec.ignore.includes(file)) return {};
      if (spec.template !== 'forbid-file' && roleOf(file) === 'TEST') return {};
      const rootFile = relative(root, realPathOf(context.physicalFilename)).split(sep).join('/');
      if (!files.some((pattern) => pattern.test(rootFile)) || except.some((pattern) => pattern.test(rootFile))) {
        return {};
      }
      if (spec.template === 'forbid-file') {
        return {
          Program() {
            context.report({ loc: { line: 1, column: 0 }, messageId: 'forbidden' });
          },
        };
      }
      if (spec.template === 'forbid-usage') return declaredUsageVisitors(context, spec.usage);
      const aliases = aliasesFor(rootFile, resolution.configs);
      return declaredImportVisitors((node, specifier, names) => {
        if (packages.some((target) => target.name.test(specifier) && takesForbidden(names, target))) {
          context.report({ node, messageId: 'forbidden' });
          return;
        }
        if (targets.length === 0) return;
        const target = resolveImportTarget(rootFile, specifier, aliases, resolution.packages, fileFor);
        if (target !== null && targets.some((pattern) => pattern.test(target))) {
          context.report({ node, messageId: 'forbidden' });
        }
      });
    },
  };
}`;
