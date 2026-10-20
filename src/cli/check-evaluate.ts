import { detectConsoleIsolation } from '../detector/console-isolation-detector.js';
import { cycleEdges } from '../detector/cycle-detector.js';
import { detectDependencyInternals } from '../detector/dependency-internals-detector.js';
import { detectEntryPurity } from '../detector/entry-purity-detector.js';
import { buildImportGraph } from '../scanner/import-graph.js';
import { detectDeepRelativeImports } from '../detector/deep-relative-detector.js';
import { layerImports } from '../detector/layer-detector.js';
import { detectForbiddenImports, type PatternConfig } from '../detector/pattern-detector.js';
import { detectPhantomDependencies } from '../detector/phantom-dependency-detector.js';
import { detectPublicApiBoundaries } from '../detector/public-api-detector.js';
import { detectServerClientBoundary } from '../detector/server-client-detector.js';
import { detectTestIsolation } from '../detector/test-isolation-detector.js';
import type { AdoptedRule, ForbiddenImportRule, ResolutionMode } from './adopted-rules.js';

export type SubjectKind = 'specifier' | 'target' | 'file';

export interface Finding {
  ruleId: string;
  file: string;
  subject: string;
  kind: SubjectKind;
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

export function evaluateRules(appDir: string, rules: readonly AdoptedRule[]): Finding[] {
  const findings = forbiddenImportFindings(
    appDir,
    rules.filter((rule): rule is ForbiddenImportRule => rule.family === 'forbidden-imports'),
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
      findings.push({ ruleId: rule.id, file: violation.file, subject: '', kind: 'file' });
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
