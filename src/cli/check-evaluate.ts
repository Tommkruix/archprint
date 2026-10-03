import { detectConsoleIsolation } from '../detector/console-isolation-detector.js';
import { detectDeepRelativeImports } from '../detector/deep-relative-detector.js';
import { detectForbiddenImports, type PatternConfig } from '../detector/pattern-detector.js';
import { detectPublicApiBoundaries } from '../detector/public-api-detector.js';
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
