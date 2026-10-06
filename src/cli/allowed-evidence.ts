import { evaluateGate } from '../detector/confidence-gate.js';
import { publicApiRuleName } from '../generator/public-api-emitters.js';
import { readAdoptedRules } from './adopted-rules.js';
import { allowedFilesByRule, readAllowed } from './allowed-exceptions.js';
import type { ScanResult } from './scan.js';

type AllowedByRule = ReadonlyMap<string, readonly string[]>;

interface Excluded<T> {
  kept: T[];
  removedFiles: number;
  keptFiles: number;
}

function exclude<T extends { file: string }>(
  violations: readonly T[],
  allowedFiles: readonly string[],
): Excluded<T> {
  const allowed = new Set(allowedFiles);
  const kept = violations.filter((violation) => !allowed.has(violation.file));
  const distinct = (list: readonly T[]): number => new Set(list.map((item) => item.file)).size;
  return { kept, removedFiles: distinct(violations) - distinct(kept), keptFiles: distinct(kept) };
}

const regate = (population: number, violating: number, roleConfidence = 1, applicable = true) =>
  evaluateGate({
    roleFileCount: population,
    violatingFileCount: violating,
    roleConfidence,
    applicable,
  });

/** Allowed files of the rules already adopted: an allowance can keep an adopted rule, never promote another. */
export function adoptedAllowances(outDir: string): AllowedByRule {
  let adopted: ReadonlySet<string>;
  try {
    adopted = new Set((readAdoptedRules(outDir) ?? []).map((rule) => rule.id));
  } catch {
    adopted = new Set();
  }
  return new Map(
    [...allowedFilesByRule(readAllowed(outDir))].filter(([rule]) => adopted.has(rule)),
  );
}

/**
 * The scan with each rule's allowed exceptions left out of its evidence: they are reviewed exceptions, so they
 * count neither for nor against the rule when it is re-inferred.
 */
export function excludeAllowed(scan: ScanResult, allowed: AllowedByRule): ScanResult {
  if (allowed.size === 0) return scan;
  const allowedFor = (rule: string): readonly string[] => allowed.get(rule) ?? [];

  const patterns = scan.patterns.map((pattern) => {
    const { kept, removedFiles, keptFiles } = exclude(
      pattern.result.violations,
      allowedFor(pattern.config.id),
    );
    if (removedFiles === 0) return pattern;
    const { stats } = pattern.result;
    const roleFileCount = stats.roleFileCount - removedFiles;
    const gate = regate(roleFileCount, keptFiles, stats.roleConfidence);
    const infraExceptions = pattern.result.infraExceptions.filter((file) =>
      kept.some((v) => v.file === file),
    );
    return {
      ...pattern,
      result: {
        ...pattern.result,
        violations: kept,
        gate,
        stats: {
          ...stats,
          roleFileCount,
          conformingFileCount: roleFileCount - keptFiles,
          violatingFileCount: keptFiles,
          ratio: gate.observedConformance,
        },
        infraExceptions,
        infraCaution: keptFiles > 0 && infraExceptions.length === keptFiles,
      },
    };
  });

  const consoleRule = exclude(scan.consoleIsolation.violations, allowedFor('console-isolation'));
  const libraryFileCount = scan.consoleIsolation.libraryFileCount - consoleRule.removedFiles;
  const deep = exclude(scan.deepRelative.violations, allowedFor('import-style'));
  const relativeImporterCount = scan.deepRelative.relativeImporterCount - deep.removedFiles;
  const tests = exclude(scan.testIsolation.violations, allowedFor('test-isolation'));
  const productionFileCount = scan.testIsolation.productionFileCount - tests.removedFiles;

  return {
    ...scan,
    patterns,
    consoleIsolation:
      consoleRule.removedFiles === 0
        ? scan.consoleIsolation
        : {
            ...scan.consoleIsolation,
            libraryFileCount,
            offenderCount: consoleRule.keptFiles,
            violations: consoleRule.kept,
            gate: regate(libraryFileCount, consoleRule.keptFiles),
          },
    deepRelative:
      deep.removedFiles === 0
        ? scan.deepRelative
        : {
            ...scan.deepRelative,
            relativeImporterCount,
            offenderCount: deep.keptFiles,
            violations: deep.kept,
            gate: regate(relativeImporterCount, deep.keptFiles),
          },
    testIsolation:
      tests.removedFiles === 0
        ? scan.testIsolation
        : {
            ...scan.testIsolation,
            productionFileCount,
            offenderCount: tests.keptFiles,
            violations: tests.kept,
            gate: regate(
              productionFileCount,
              tests.keptFiles,
              1,
              scan.testIsolation.testFileCount > 0,
            ),
          },
    publicApi: {
      ...scan.publicApi,
      groups: scan.publicApi.groups.map((group) => {
        const api = exclude(group.violations, allowedFor(publicApiRuleName(group.dir)));
        if (api.removedFiles === 0) return group;
        const consumerCount = group.consumerCount - api.removedFiles;
        return {
          ...group,
          consumerCount,
          deepImporterCount: api.keptFiles,
          violations: api.kept,
          gate: regate(consumerCount, api.keptFiles),
        };
      }),
    },
  };
}
