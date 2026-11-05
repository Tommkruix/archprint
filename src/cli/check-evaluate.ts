import { detectAppIsolation } from '../detector/app-isolation-detector.js';
import { detectConsoleIsolation } from '../detector/console-isolation-detector.js';
import { cycleEdges } from '../detector/cycle-detector.js';
import { detectDependencyInternals } from '../detector/dependency-internals-detector.js';
import { detectEntryPurity } from '../detector/entry-purity-detector.js';
import { detectEnvAccess } from '../detector/env-access-detector.js';
import { detectFeatureSliceIsolation } from '../detector/feature-slice-detector.js';
import type { SiblingViolation } from '../detector/sibling-isolation.js';
import { buildImportGraph } from '../scanner/import-graph.js';
import { detectDeepRelativeImports } from '../detector/deep-relative-detector.js';
import { layerImports } from '../detector/layer-detector.js';
import { detectForbiddenImports, type PatternConfig } from '../detector/pattern-detector.js';
import { detectPhantomDependencies } from '../detector/phantom-dependency-detector.js';
import { detectPublicApiBoundaries } from '../detector/public-api-detector.js';
import { detectRoleLayering } from '../detector/role-layering-detector.js';
import { detectServerClientBoundary } from '../detector/server-client-detector.js';
import { detectStoriesIsolation } from '../detector/stories-isolation-detector.js';
import { detectTestIsolation } from '../detector/test-isolation-detector.js';
import { detectUiDataIsolation } from '../detector/ui-data-isolation-detector.js';
import { detectWorkspacePackageApi } from '../detector/workspace-package-detector.js';
import * as path from 'node:path';
import { type DeclaredMeasure, loadCodebase, measureDeclared } from '../detector/declared-rules.js';
import {
  type AdoptedRule,
  type DeclaredAdoptedRule,
  declaredDefinition,
  type ForbiddenImportRule,
  type ResolutionMode,
} from './adopted-rules.js';

/** What a finding names: an import as written, the file an import resolves to, or what a file reads (`console`, `process.env`). */
export type SubjectKind = 'specifier' | 'target' | 'usage';

export interface Finding {
  ruleId: string;
  file: string;
  subject: string;
  kind: SubjectKind;
  /** The line, when the rule's measurement knows it (declared rules). */
  line?: number;
}

const toPatternConfig = (rule: ForbiddenImportRule): PatternConfig => ({
  id: rule.id,
  name: rule.id,
  description: rule.statement,
  roles: rule.roles,
  forbidden: rule.forbidden.map((marker) => new RegExp(marker.source, marker.flags)),
});

function forbiddenImportFindings(appDir: string, rules: readonly ForbiddenImportRule[]): Finding[] {
  const findings: Finding[] = [];
  const modes: ResolutionMode[] = ['deep', 'fast'];
  for (const mode of modes) {
    const group = rules.filter((rule) => rule.mode === mode);
    if (group.length === 0) continue;
    const results = detectForbiddenImports(appDir, group.map(toPatternConfig), {
      resolve: mode === 'deep',
    });
    results.forEach((result, index) => {
      for (const violation of result.violations) {
        findings.push({
          ruleId: group[index]!.id,
          file: violation.file,
          subject: violation.specifier,
          kind: 'specifier',
        });
      }
    });
  }
  return findings;
}

function containerFindings(
  rules: readonly AdoptedRule[],
  groups: readonly { container: string; violations: readonly SiblingViolation[] }[],
): Finding[] {
  return rules.flatMap((rule) => {
    if (rule.family !== 'feature-slice' && rule.family !== 'app-isolation') return [];
    const group = groups.find((candidate) => candidate.container === rule.container);
    return (group?.violations ?? []).map((violation) => ({
      ruleId: rule.id,
      file: violation.file,
      subject: violation.target,
      kind: 'target' as const,
    }));
  });
}

const DECLARED_KINDS: Record<DeclaredAdoptedRule['template'], SubjectKind> = {
  'forbid-import': 'specifier',
  'forbid-usage': 'usage',
  'forbid-file': 'target',
};

/** Each declared rule measured over the app's files, from the root its globs are written against. */
export function measureAdopted(
  appDir: string,
  rules: readonly DeclaredAdoptedRule[],
  rulesDir: string,
): Map<string, DeclaredMeasure> {
  const byRoot = new Map<string, DeclaredAdoptedRule[]>();
  for (const rule of rules) {
    const root = path.resolve(rulesDir, rule.root);
    byRoot.set(root, [...(byRoot.get(root) ?? []), rule]);
  }
  const measures = new Map<string, DeclaredMeasure>();
  for (const [root, group] of byRoot) {
    const results = measureDeclared(loadCodebase(root, appDir), group.map(declaredDefinition));
    group.forEach((rule, index) => measures.set(rule.id, results[index]!));
  }
  return measures;
}

function declaredFindings(
  appDir: string,
  rules: readonly DeclaredAdoptedRule[],
  rulesDir: string | undefined,
): Finding[] {
  if (rules.length === 0) return [];
  if (rulesDir === undefined) {
    throw new Error(
      'Declared rules are measured from the rules directory that records their root.',
    );
  }
  const measures = measureAdopted(appDir, rules, rulesDir);
  return rules.flatMap((rule) =>
    measures.get(rule.id)!.violations.map((violation) => ({
      ruleId: rule.id,
      file: violation.file,
      subject: violation.subject,
      kind: DECLARED_KINDS[rule.template],
      line: violation.line,
    })),
  );
}

/**
 * What breaks each rule in the app today. Declared rules need `rulesDir`, the rules directory their recorded root
 * is relative to (in `check`, the base snapshot's copy of it for the base).
 */
export function evaluateRules(
  appDir: string,
  rules: readonly AdoptedRule[],
  rulesDir?: string,
): Finding[] {
  const findings = forbiddenImportFindings(
    appDir,
    rules.filter((rule): rule is ForbiddenImportRule => rule.family === 'forbidden-imports'),
  );
  findings.push(
    ...declaredFindings(
      appDir,
      rules.filter((rule): rule is DeclaredAdoptedRule => rule.family === 'declared'),
      rulesDir,
    ),
  );
  const byFamily = (family: AdoptedRule['family']): AdoptedRule[] =>
    rules.filter((rule) => rule.family === family);

  for (const rule of byFamily('test-isolation')) {
    for (const violation of detectTestIsolation(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.target,
        kind: 'target',
      });
    }
  }
  for (const rule of byFamily('console-isolation')) {
    for (const violation of detectConsoleIsolation(appDir).violations) {
      findings.push({ ruleId: rule.id, file: violation.file, subject: 'console', kind: 'usage' });
    }
  }
  for (const rule of byFamily('cycles')) {
    for (const edge of cycleEdges(buildImportGraph(appDir, { resolve: false }))) {
      findings.push({ ruleId: rule.id, file: edge.file, subject: edge.target, kind: 'target' });
    }
  }
  for (const rule of byFamily('dependency-hygiene')) {
    for (const violation of detectDependencyInternals(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.specifier,
        kind: 'specifier',
      });
    }
  }
  for (const rule of byFamily('entry-purity')) {
    for (const edge of detectEntryPurity(appDir).imports) {
      findings.push({ ruleId: rule.id, file: edge.importer, subject: edge.file, kind: 'target' });
    }
  }
  for (const rule of byFamily('phantom-deps')) {
    for (const violation of detectPhantomDependencies(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.specifier,
        kind: 'specifier',
      });
    }
  }
  for (const rule of byFamily('server-client')) {
    for (const violation of detectServerClientBoundary(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.target,
        kind: 'target',
      });
    }
  }
  for (const rule of byFamily('import-style')) {
    for (const violation of detectDeepRelativeImports(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.specifier,
        kind: 'specifier',
      });
    }
  }
  for (const rule of byFamily('env-access')) {
    for (const violation of detectEnvAccess(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: 'process.env',
        kind: 'usage',
      });
    }
  }
  for (const rule of byFamily('workspace-package-api')) {
    for (const violation of detectWorkspacePackageApi(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.specifier,
        kind: 'specifier',
      });
    }
  }
  for (const rule of byFamily('stories-isolation')) {
    for (const violation of detectStoriesIsolation(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.importer,
        subject: violation.file,
        kind: 'target',
      });
    }
  }
  for (const rule of byFamily('ui-data')) {
    for (const violation of detectUiDataIsolation(appDir).violations) {
      findings.push({
        ruleId: rule.id,
        file: violation.file,
        subject: violation.target,
        kind: 'target',
      });
    }
  }
  const roleLayering = byFamily('role-layering');
  if (roleLayering.length > 0) {
    const boundaries = detectRoleLayering(appDir).boundaries;
    for (const rule of roleLayering) {
      if (rule.family !== 'role-layering') continue;
      const boundary = boundaries.find(
        (candidate) => candidate.from === rule.from && candidate.to === rule.to,
      );
      for (const violation of boundary?.violations ?? []) {
        findings.push({
          ruleId: rule.id,
          file: violation.file,
          subject: violation.target,
          kind: 'target',
        });
      }
    }
  }
  const slices = byFamily('feature-slice');
  if (slices.length > 0)
    findings.push(...containerFindings(slices, detectFeatureSliceIsolation(appDir).groups));
  const apps = byFamily('app-isolation');
  if (apps.length > 0) findings.push(...containerFindings(apps, detectAppIsolation(appDir).groups));
  const layers = byFamily('layer');
  if (layers.length > 0) {
    const importsAcross = layerImports(appDir);
    for (const rule of layers) {
      if (rule.family !== 'layer') continue;
      for (const edge of importsAcross(rule.from, rule.to)) {
        findings.push({
          ruleId: rule.id,
          file: edge.file,
          subject: edge.specifier,
          kind: 'specifier',
        });
      }
    }
  }
  const publicApi = byFamily('public-api');
  if (publicApi.length > 0) {
    const groups = detectPublicApiBoundaries(appDir).groups;
    for (const rule of publicApi) {
      if (rule.family !== 'public-api') continue;
      const group = groups.find((candidate) => candidate.dir === rule.dir);
      for (const violation of group?.violations ?? []) {
        findings.push({
          ruleId: rule.id,
          file: violation.file,
          subject: violation.target,
          kind: 'target',
        });
      }
    }
  }
  return findings;
}
